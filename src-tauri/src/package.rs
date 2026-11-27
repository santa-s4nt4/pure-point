use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, BufReader, Read, Write},
    path::Path,
    sync::Arc,
};
use tempfile::{NamedTempFile, TempDir};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

/// Private, immutable archive shared by the open document and its media tokens.
/// Independent file handles keep concurrent saves, playback and previews seekable.
pub struct Source {
    directory: TempDir,
}

impl Source {
    pub fn open(&self) -> Result<File, String> {
        File::open(self.directory.path().join("source.pptx")).map_err(|e| e.to_string())
    }
}

pub fn read(path: &Path) -> Result<Arc<Source>, String> {
    let mut builder = tempfile::Builder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(fs::Permissions::from_mode(0o700));
    }
    let directory = builder
        .prefix("pure-point-document-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    // The destination must not exist for fs::copy to use macOS's APFS clone.
    // Across volumes the same call copies to disk without buffering the file in RAM.
    fs::copy(path, directory.path().join("source.pptx"))
        .map_err(|e| format!("Could not make a working copy of the presentation: {e}"))?;
    Ok(Arc::new(Source { directory }))
}

#[derive(Serialize)]
pub struct Preview {
    pub xml: BTreeMap<String, String>,
    pub media: BTreeMap<String, crate::movies::MovieAsset>,
}

#[derive(Deserialize, Default)]
pub struct Changes {
    #[serde(default)]
    pub removed: std::collections::HashSet<String>,
    #[serde(default, rename = "videoFiles")]
    pub video_files: BTreeMap<String, String>,
    pub xml: BTreeMap<String, String>,
    pub media: BTreeMap<String, String>,
}

pub fn preview(source: &Arc<Source>) -> Result<Preview, String> {
    let mut archive = ZipArchive::new(BufReader::new(source.open()?))
        .map_err(|_| "Could not read the presentation. Open an unencrypted PowerPoint file.")?;
    let mut result = Preview {
        xml: BTreeMap::new(),
        media: BTreeMap::new(),
    };
    if let Err(error) = read_preview(&mut archive, source, &mut result) {
        crate::movies::release_movies(result.media.into_values().map(|m| m.token).collect());
        return Err(error);
    }
    Ok(result)
}

fn read_preview(
    archive: &mut ZipArchive<BufReader<File>>,
    source: &Arc<Source>,
    result: &mut Preview,
) -> Result<(), String> {
    // Only XML is sent to the WebView as text. Bound that allocation independently
    // of the archive size and the size of any media that stays on disk.
    let mut xml_remaining = 512 * 1024 * 1024u64;
    let directory_start = archive.central_directory_start();
    for i in 0..archive.len() {
        let name = archive
            .name_for_index(i)
            .ok_or("Missing ZIP entry.")?
            .to_owned();
        let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "bmp" => "image/bmp",
            "tiff" | "tif" => "image/tiff",
            "mp4" | "m4v" => "video/mp4",
            "mov" => "video/quicktime",
            "webm" => "video/webm",
            "ogv" => "video/ogg",
            "mpg" | "mpeg" => "video/mpeg",
            "wmv" => "video/x-ms-wmv",
            "avi" => "video/x-msvideo",
            _ => "",
        };
        let xml = matches!(ext.as_str(), "xml" | "rels");
        if !xml && mime.is_empty() {
            continue;
        }
        let part = archive.by_index(i).map_err(|e| e.to_string())?;
        let size = part.size();
        if !xml {
            if part
                .data_start()
                .checked_add(part.compressed_size())
                .is_none_or(|end| end > directory_start)
            {
                return Err(format!("Invalid ZIP media range for {name}."));
            }
            let offset = if part.compression() == zip::CompressionMethod::Stored {
                if part.compressed_size() != size {
                    return Err(format!("Invalid stored media size for {name}."));
                }
                Some(part.data_start())
            } else {
                None
            };
            let asset = crate::movies::register_package(Arc::clone(source), i, offset, size, mime)?;
            result.media.insert(name, asset);
            continue;
        }
        xml_remaining = xml_remaining
            .checked_sub(size)
            .ok_or("The presentation contains more than 512 MB of uncompressed XML.")?;
        let mut data = Vec::new();
        part.take(size + 1)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        if data.len() as u64 != size {
            return Err(format!("The ZIP entry size for {name} is incorrect."));
        }
        // Office normally emits UTF-8. XML also permits either byte order of UTF-16.
        let value = if data.starts_with(&[255, 254]) || data.starts_with(&[254, 255]) {
            let little = data[0] == 255;
            let (words, trailing) = data[2..].as_chunks::<2>();
            if !trailing.is_empty() {
                return Err(format!("Incomplete UTF-16 in {name}."));
            }
            char::decode_utf16(words.iter().map(|c| {
                if little {
                    u16::from_le_bytes(*c)
                } else {
                    u16::from_be_bytes(*c)
                }
            }))
            .collect::<Result<String, _>>()
            .map_err(|e| e.to_string())?
        } else {
            String::from_utf8(data).map_err(|e| e.to_string())?
        };
        result.xml.insert(name, value);
    }
    Ok(())
}

pub fn save(path: &Path, original: Option<&Source>, changes: Changes) -> Result<(), String> {
    let folder = path
        .parent()
        .ok_or("Choose a destination to save the presentation.")?;
    let mut temp = NamedTempFile::new_in(folder).map_err(|e| e.to_string())?;
    let unchanged = changes.video_files.is_empty()
        && changes.xml.is_empty()
        && changes.media.is_empty()
        && changes.removed.is_empty();
    if let Some(source) = original.filter(|_| unchanged) {
        io::copy(&mut source.open()?, temp.as_file_mut()).map_err(|e| e.to_string())?;
    } else {
        let mut output = ZipWriter::new(temp.as_file_mut());
        if let Some(source) = original {
            let mut source =
                ZipArchive::new(BufReader::new(source.open()?)).map_err(|e| e.to_string())?;
            for i in 0..source.len() {
                let part = source.by_index_raw(i).map_err(|e| e.to_string())?;
                if !changes.removed.contains(part.name())
                    && !changes.xml.contains_key(part.name())
                    && !changes.media.contains_key(part.name())
                    && !changes.video_files.contains_key(part.name())
                {
                    output.raw_copy_file(part).map_err(|e| e.to_string())?;
                }
            }
        }
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, contents) in changes.xml {
            output
                .start_file(name, options)
                .map_err(|e| e.to_string())?;
            output
                .write_all(contents.as_bytes())
                .map_err(|e| e.to_string())?;
        }
        for (name, contents) in changes.media {
            let bytes = STANDARD.decode(contents).map_err(|e| e.to_string())?;
            output
                .start_file(name, options)
                .map_err(|e| e.to_string())?;
            output.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        for (name, token) in changes.video_files {
            let mut file = crate::movies::open_file(&token)?;
            let size = file.limit();
            output
                .start_file(
                    name,
                    SimpleFileOptions::default()
                        .large_file(size >= u32::MAX as u64)
                        .compression_method(zip::CompressionMethod::Stored),
                )
                .map_err(|e| e.to_string())?;
            if io::copy(&mut file, &mut output).map_err(|e| e.to_string())? != size {
                return Err("The media file ended before all its data could be saved.".into());
            }
        }
        output.finish().map_err(|e| e.to_string())?;
    }
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Seek, SeekFrom};

    #[test]
    fn untouched_archive_and_opaque_parts_survive_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("roundtrip.pptx");
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in [
            ("ppt/slides/slide1.xml", "<slide/>"),
            ("ppt/media/image.jpg", "image"),
            ("ppt/embeddings/object.bin", "opaque"),
            ("ppt/notesSlides/notesSlide2.xml", "<notes/>"),
        ] {
            archive
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            archive.write_all(data.as_bytes()).unwrap();
        }
        let original = archive.finish().unwrap().into_inner();
        fs::write(&path, &original).unwrap();
        let source = read(&path).unwrap();
        // Another writer may replace or truncate the opened path while we edit.
        fs::write(&path, b"external edit").unwrap();
        save(&path, Some(&source), Changes::default()).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let mut edited = Changes::default();
        edited
            .xml
            .insert("ppt/slides/slide1.xml".into(), "<changed/>".into());
        edited
            .removed
            .insert("ppt/notesSlides/notesSlide2.xml".into());
        save(&path, Some(&source), edited).unwrap();
        let mut result = ZipArchive::new(File::open(path).unwrap()).unwrap();
        assert!(result.by_name("ppt/notesSlides/notesSlide2.xml").is_err());
        for (name, expected) in [
            ("ppt/embeddings/object.bin", "opaque"),
            ("ppt/media/image.jpg", "image"),
            ("ppt/slides/slide1.xml", "<changed/>"),
        ] {
            let mut data = String::new();
            result
                .by_name(name)
                .unwrap()
                .read_to_string(&mut data)
                .unwrap();
            assert_eq!(data, expected);
        }
    }

    #[test]
    fn large_archive_opens_without_expanding_media_and_retains_it_on_save() {
        const LARGE: u64 = 513 * 1024 * 1024;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.pptx");
        let mut file = File::create(&path).unwrap();
        // A sparse ZIP prefix crosses the old on-disk limit without consuming
        // that much CI disk space. The deflated part crosses the old preview limit.
        file.seek(SeekFrom::Start(LARGE)).unwrap();
        let mut archive = ZipWriter::new(file);
        let slide = "ppt/slides/slide1.xml";
        let movie = "ppt/media/media1.mp4";
        let image = "ppt/media/image1.tif";
        let stored =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        archive.start_file(slide, stored).unwrap();
        archive.write_all(b"<slide/>").unwrap();
        archive.start_file(image, stored).unwrap();
        archive.write_all(b"TIFF payload").unwrap();
        archive
            .start_file(
                movie,
                SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated)
                    .compression_level(Some(1)),
            )
            .unwrap();
        io::copy(&mut io::repeat(0).take(LARGE), &mut archive).unwrap();
        archive.finish().unwrap();
        assert!(fs::metadata(&path).unwrap().len() > LARGE);

        let source = read(&path).unwrap();
        let parts = preview(&source).unwrap();
        assert_eq!(parts.xml[slide], "<slide/>");
        assert_eq!(parts.media[movie].mime, "video/mp4");
        assert_eq!(parts.media[image].mime, "image/tiff");
        let mut edited = Changes::default();
        edited.xml.insert(slide.into(), "<edited/>".into());
        save(&path, Some(&source), edited).unwrap();
        let mut result = ZipArchive::new(File::open(&path).unwrap()).unwrap();
        {
            let mut video = result.by_name(movie).unwrap();
            assert_eq!(video.size(), LARGE);
            // Read through EOF to validate the deflated payload and ZIP CRC.
            assert_eq!(io::copy(&mut video, &mut io::sink()).unwrap(), LARGE);
        }
        let mut xml = String::new();
        result
            .by_name(slide)
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert_eq!(xml, "<edited/>");
        // The picture token remains usable after overwriting the presentation
        // and releasing the document's ownership (e.g. a copied picture).
        drop(source);
        let mut data = Vec::new();
        crate::movies::open_file(&parts.media[image].token)
            .unwrap()
            .read_to_end(&mut data)
            .unwrap();
        assert_eq!(data, b"TIFF payload");
        crate::movies::release_movies(parts.media.into_values().map(|m| m.token).collect());
    }
}
