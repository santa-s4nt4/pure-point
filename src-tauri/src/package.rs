use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{self, Cursor, Read, Write},
    path::Path,
};
use tempfile::NamedTempFile;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

#[derive(Serialize)]
#[serde(untagged)]
pub enum Media {
    Inline(String),
    Movie(crate::movies::MovieAsset),
}
#[derive(Serialize)]
pub struct Preview {
    pub xml: BTreeMap<String, String>,
    pub media: BTreeMap<String, Media>,
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

pub fn preview(bytes: &[u8]) -> Result<Preview, String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "Could not read the presentation. Open an unencrypted PowerPoint file.")?;
    let mut result = Preview {
        xml: BTreeMap::new(),
        media: BTreeMap::new(),
    };
    if let Err(error) = read_preview(&mut archive, &mut result) {
        let tokens = result
            .media
            .values()
            .filter_map(|m| match m {
                Media::Movie(v) => Some(v.token.clone()),
                _ => None,
            })
            .collect();
        crate::movies::release_movies(tokens);
        return Err(error);
    }
    Ok(result)
}

fn read_preview(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    result: &mut Preview,
) -> Result<(), String> {
    let mut remaining = 512 * 1024 * 1024u64;
    for i in 0..archive.len() {
        let mut part = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = part.name().to_owned();
        let xml = name.ends_with(".xml") || name.ends_with(".rels");
        let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "bmp" => "image/bmp",
            "mp4" | "m4v" => "video/mp4",
            "mov" => "video/quicktime",
            "webm" => "video/webm",
            "ogv" => "video/ogg",
            "mpg" | "mpeg" => "video/mpeg",
            "wmv" => "video/x-ms-wmv",
            "avi" => "video/x-msvideo",
            _ => "",
        };
        if !xml && mime.is_empty() {
            continue;
        }
        if mime.starts_with("video/") {
            let size = part.size();
            remaining = remaining
                .checked_sub(size)
                .ok_or("The extracted presentation exceeds 512 MB.")?;
            let asset = crate::movies::extract(&mut part, &ext, mime, size)?;
            result.media.insert(name, Media::Movie(asset));
            continue;
        }
        let mut data = Vec::new();
        (&mut part)
            .take(remaining + 1)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        remaining = remaining
            .checked_sub(data.len() as u64)
            .ok_or("The extracted presentation exceeds 512 MB.")?;
        if xml {
            // Office normally emits UTF-8. XML also permits either byte order of UTF-16.
            let value = if data.starts_with(&[255, 254]) || data.starts_with(&[254, 255]) {
                let little = data[0] == 255;
                let chars: Vec<_> = data[2..]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| {
                        if little {
                            u16::from_le_bytes([c[0], c[1]])
                        } else {
                            u16::from_be_bytes([c[0], c[1]])
                        }
                    })
                    .collect();
                String::from_utf16(&chars).map_err(|e| e.to_string())?
            } else {
                String::from_utf8(data).map_err(|e| e.to_string())?
            };
            result.xml.insert(name, value);
        } else {
            result.media.insert(
                name,
                Media::Inline(format!("data:{mime};base64,{}", STANDARD.encode(data))),
            );
        }
    }
    Ok(())
}

pub fn save(path: &Path, original: Option<&[u8]>, changes: Changes) -> Result<(), String> {
    let folder = path
        .parent()
        .ok_or("Choose a destination to save the presentation.")?;
    let mut temp = NamedTempFile::new_in(folder).map_err(|e| e.to_string())?;
    let unchanged = changes.video_files.is_empty()
        && changes.xml.is_empty()
        && changes.media.is_empty()
        && changes.removed.is_empty();
    if let Some(bytes) = original.filter(|_| unchanged) {
        temp.write_all(bytes).map_err(|e| e.to_string())?;
    } else {
        let mut output = ZipWriter::new(temp.as_file_mut());
        if let Some(bytes) = original {
            let mut source = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
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
            output
                .start_file(
                    name,
                    SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
                )
                .map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut output).map_err(|e| e.to_string())?;
        }
        output.finish().map_err(|e| e.to_string())?;
    }
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn read(path: &Path) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let limit = 512 * 1024 * 1024;
    let mut data = Vec::new();
    io::Read::take(file, limit + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > limit {
        return Err("The presentation exceeds 512 MB.".into());
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        save(&path, Some(&original), Changes::default()).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let mut edited = Changes::default();
        edited
            .xml
            .insert("ppt/slides/slide1.xml".into(), "<changed/>".into());
        edited
            .removed
            .insert("ppt/notesSlides/notesSlide2.xml".into());
        save(&path, Some(&original), edited).unwrap();
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
}
