use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::{c_char, CStr, CString},
    fs::{self, File, OpenOptions},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex, OnceLock},
    thread,
    time::Duration,
};
use tempfile::{NamedTempFile, TempDir, TempPath};

use crate::package::Source;

extern "C" {
    fn pp_prepare_movie(
        source: *const c_char,
        out: *const c_char,
        poster: *const c_char,
        w: *mut f64,
        h: *mut f64,
    ) -> *mut c_char;
    fn pp_free_movie_error(error: *mut c_char);
}

struct CacheEntry {
    backing: MediaBacking,
    mime: String,
    size: u64,
}

enum MediaBacking {
    Imported {
        _dir: TempDir,
        file: PathBuf,
    },
    Stored {
        source: Arc<Source>,
        offset: u64,
    },
    Compressed {
        source: Arc<Source>,
        index: usize,
        extracted: Mutex<Option<TempPath>>,
    },
}

impl CacheEntry {
    fn open_range(&self, start: u64, count: u64) -> io::Result<io::Take<File>> {
        let (mut file, base) = match &self.backing {
            MediaBacking::Imported { file, .. } => (File::open(file)?, 0),
            MediaBacking::Stored { source, offset } => {
                (source.open().map_err(io::Error::other)?, *offset)
            }
            MediaBacking::Compressed {
                source,
                index,
                extracted,
            } => {
                let mut cached = extracted.lock().unwrap();
                if cached.is_none() {
                    let file = source.open().map_err(io::Error::other)?;
                    let mut archive = zip::ZipArchive::new(BufReader::new(file))?;
                    let member = archive.by_index(*index)?;
                    let mut temp = NamedTempFile::new()?;
                    let bytes = io::copy(&mut member.take(self.size.saturating_add(1)), &mut temp)?;
                    if bytes != self.size {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "Incorrect media size in the presentation.",
                        ));
                    }
                    // A document can contain more media parts than the process's
                    // open-file limit. Keep the path and reopen on each request.
                    *cached = Some(temp.into_temp_path());
                }
                (File::open(cached.as_ref().unwrap())?, 0)
            }
        };
        let position = base
            .checked_add(start)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Invalid media offset."))?;
        file.seek(SeekFrom::Start(position))?;
        Ok(file.take(count))
    }
}

static FILES: LazyLock<Mutex<HashMap<String, Arc<CacheEntry>>>> = LazyLock::new(Default::default);
static UPLOADS: LazyLock<Mutex<HashMap<String, Upload>>> = LazyLock::new(Default::default);
static ADDRESS: OnceLock<Result<SocketAddr, String>> = OnceLock::new();
const MAX_VIDEO_IMPORT_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Serialize, Clone)]
pub struct MovieAsset {
    pub token: String,
    pub url: String,
    pub mime: String,
}

#[derive(Serialize)]
pub struct Prepared {
    name: String,
    w: f64,
    h: f64,
    pub asset: MovieAsset,
    poster: String,
}

struct Upload {
    _dir: TempDir,
    path: PathBuf,
    name: String,
    size: u64,
}

fn token() -> Result<String, String> {
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    Ok(format!("{:032x}", u128::from_ne_bytes(random)))
}
fn new_dir() -> Result<TempDir, String> {
    tempfile::Builder::new()
        .prefix("pure-point-movie-")
        .tempdir()
        .map_err(|e| e.to_string())
}
fn entry(id: &str) -> Result<Arc<CacheEntry>, String> {
    FILES
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| "The local media is no longer available.".into())
}
pub fn open_file(id: &str) -> Result<io::Take<File>, String> {
    let item = entry(id)?;
    item.open_range(0, item.size).map_err(|e| e.to_string())
}
fn register(backing: MediaBacking, size: u64, mime: &str) -> Result<MovieAsset, String> {
    let addr = ADDRESS
        .get_or_init(start_server)
        .as_ref()
        .map_err(Clone::clone)?;
    let id = token()?;
    FILES.lock().unwrap().insert(
        id.clone(),
        Arc::new(CacheEntry {
            backing,
            size,
            mime: mime.to_owned(),
        }),
    );
    Ok(MovieAsset {
        url: format!("http://{addr}/{id}"),
        token: id,
        mime: mime.to_owned(),
    })
}
pub fn register_package(
    source: Arc<Source>,
    index: usize,
    offset: Option<u64>,
    size: u64,
    mime: &str,
) -> Result<MovieAsset, String> {
    // Stored entries can be served directly from the archive. A seekable
    // playback file is needed for compressed entries only when first read.
    let backing = match offset {
        Some(offset) => MediaBacking::Stored { source, offset },
        None => MediaBacking::Compressed {
            source,
            index,
            extracted: Mutex::default(),
        },
    };
    register(backing, size, mime)
}

fn register_import(dir: TempDir, file: PathBuf, mime: &str) -> Result<MovieAsset, String> {
    let size = fs::metadata(&file).map_err(|e| e.to_string())?.len();
    register(MediaBacking::Imported { _dir: dir, file }, size, mime)
}
fn extract(input: &mut impl Read, ext: &str, mime: &str, size: u64) -> Result<MovieAsset, String> {
    let dir = new_dir()?;
    let path = dir.path().join(format!("movie.{ext}"));
    let mut output = File::create(&path).map_err(|e| e.to_string())?;
    let written = io::copy(&mut input.take(size + 1), &mut output).map_err(|e| e.to_string())?;
    if written != size {
        return Err("Invalid movie size in the presentation.".into());
    }
    register_import(dir, path, mime)
}
fn prepare(source: &Path, name: String) -> Result<Prepared, String> {
    if fs::metadata(source).map_err(|e| e.to_string())?.len() > MAX_VIDEO_IMPORT_BYTES {
        return Err("The video exceeds 512 MB.".into());
    }
    let dir = new_dir()?;
    let path = dir.path().join("video.mp4");
    let poster_path = dir.path().join("poster.png");
    let cpath = |p: &Path| CString::new(p.as_os_str().as_bytes()).map_err(|e| e.to_string());
    let src = cpath(source)?;
    let dst = cpath(&path)?;
    let png = cpath(&poster_path)?;
    let (mut w, mut h) = (0., 0.);
    let err = unsafe { pp_prepare_movie(src.as_ptr(), dst.as_ptr(), png.as_ptr(), &mut w, &mut h) };
    if !err.is_null() {
        let msg = unsafe { CStr::from_ptr(err) }
            .to_string_lossy()
            .into_owned();
        unsafe { pp_free_movie_error(err) };
        // WebKit supports some containers that AVFoundation cannot export.
        // Retain their bytes and let the WebView read the poster over HTTP.
        let ext = source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let mime = match ext.as_str() {
            "webm" => "video/webm",
            "ogv" => "video/ogg",
            "mpeg" | "mpg" => "video/mpeg",
            "avi" => "video/x-msvideo",
            "wmv" => "video/x-ms-wmv",
            _ => return Err(msg),
        };
        let mut file = File::open(source).map_err(|e| e.to_string())?;
        let size = file.metadata().map_err(|e| e.to_string())?.len();
        return Ok(Prepared {
            name,
            w: 0.,
            h: 0.,
            poster: String::new(),
            asset: extract(&mut file, &ext, mime, size)?,
        });
    }
    let poster = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(fs::read(&poster_path).map_err(|e| e.to_string())?)
    );
    fs::remove_file(poster_path).map_err(|e| e.to_string())?;
    Ok(Prepared {
        name,
        w,
        h,
        asset: register_import(dir, path, "video/mp4")?,
        poster,
    })
}
#[tauri::command]
pub async fn pick_movie() -> Result<Option<Prepared>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter(
            "Video",
            &[
                "mp4", "m4v", "mov", "webm", "ogv", "mpeg", "mpg", "avi", "wmv",
            ],
        )
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let file = file.path().to_path_buf();
    let name = file
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    tauri::async_runtime::spawn_blocking(move || prepare(&file, name))
        .await
        .map_err(|e| e.to_string())?
        .map(Some)
}
#[tauri::command]
pub fn start_movie_upload(name: String, size: u64) -> Result<String, String> {
    if size == 0 || size > MAX_VIDEO_IMPORT_BYTES {
        return Err("Choose a video between 1 byte and 512 MB.".into());
    }
    let ext = Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty() && e.len() <= 5 && e.bytes().all(|b| b.is_ascii_alphanumeric()))
        .ok_or("Invalid movie filename.")?;
    let dir = new_dir()?;
    let path = dir.path().join(format!("input.{ext}"));
    File::create(&path).map_err(|e| e.to_string())?;
    let id = token()?;
    UPLOADS.lock().unwrap().insert(
        id.clone(),
        Upload {
            _dir: dir,
            path,
            name,
            size,
        },
    );
    Ok(id)
}
#[tauri::command]
pub fn append_movie_chunk(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .ok_or("Invalid movie upload headers.")
    };
    let id = header("x-movie-id")?;
    let offset = header("x-movie-offset")?
        .parse::<u64>()
        .map_err(|e| e.to_string())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Invalid movie chunk.".into());
    };
    append(id, offset, bytes)
}
fn append(id: &str, offset: u64, bytes: &[u8]) -> Result<(), String> {
    let uploads = UPLOADS.lock().unwrap();
    let upload = uploads.get(id).ok_or("Movie upload expired.")?;
    let mut file = OpenOptions::new()
        .append(true)
        .open(&upload.path)
        .map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != offset
        || offset
            .checked_add(bytes.len() as u64)
            .is_none_or(|n| n > upload.size)
    {
        return Err("Unexpected movie chunk offset.".into());
    }
    file.write_all(bytes).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn finish_movie_upload(id: String) -> Result<Prepared, String> {
    let upload = UPLOADS
        .lock()
        .unwrap()
        .remove(&id)
        .ok_or("Movie upload expired.")?;
    tauri::async_runtime::spawn_blocking(move || {
        if fs::metadata(&upload.path).map_err(|e| e.to_string())?.len() != upload.size {
            return Err("The movie upload was incomplete.".into());
        }
        prepare(&upload.path, upload.name)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_movie_upload(id: String) {
    UPLOADS.lock().unwrap().remove(&id);
}
#[tauri::command]
pub fn release_movies(tokens: Vec<String>) {
    let mut files = FILES.lock().unwrap();
    for id in tokens {
        files.remove(&id);
    }
}
pub fn clear() {
    FILES.lock().unwrap().clear();
    UPLOADS.lock().unwrap().clear();
}

fn start_server() -> Result<SocketAddr, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    thread::Builder::new()
        .name("local-media".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                thread::spawn(move || {
                    let _ = serve(stream, addr);
                });
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(addr)
}
fn byte_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    if len == 0 {
        return None;
    }
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        return (suffix > 0).then_some((len.saturating_sub(suffix), len - 1));
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        len - 1
    } else {
        end.parse::<u64>().ok()?.min(len - 1)
    };
    (start <= end).then_some((start, end))
}
fn serve(mut stream: TcpStream, addr: SocketAddr) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;
    let mut reader = BufReader::new((&stream).take(8192));
    let mut first = String::new();
    reader.read_line(&mut first)?;
    let mut words = first.split_whitespace();
    let method = words.next();
    let id = words.next().and_then(|s| s.strip_prefix('/')).unwrap_or("");
    let mut local = false;
    let mut range = None;
    let mut header = String::new();
    loop {
        header.clear();
        if reader.read_line(&mut header)? == 0 || header == "\r\n" {
            break;
        }
        if let Some((k, v)) = header.split_once(':') {
            if k.eq_ignore_ascii_case("host") {
                local = v.trim() == addr.to_string();
            }
            if k.eq_ignore_ascii_case("range") {
                range = Some(v.trim().to_string());
            }
        }
    }
    let item = entry(id)
        .ok()
        .filter(|_| local && matches!(method, Some("HEAD" | "GET")));
    let Some(item) = item else {
        return stream.write_all(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
    };
    let size = item.size;
    let (start, count, status, extra) = if let Some(r) = range {
        let Some((start, end)) = byte_range(&r, size) else {
            return write!(stream,"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{size}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        };
        (
            start,
            end - start + 1,
            "206 Partial Content",
            format!("Content-Range: bytes {start}-{end}/{size}\r\n"),
        )
    } else {
        (0, size, "200 OK", String::new())
    };
    let body = if method == Some("GET") {
        match item.open_range(start, count) {
            Ok(reader) => Some(reader),
            Err(_) => return stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
        }
    } else {
        None
    };
    write!(stream,"HTTP/1.1 {status}\r\nContent-Type: {}\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'\r\nAccess-Control-Allow-Origin: *\r\nAccept-Ranges: bytes\r\n{extra}Content-Length: {count}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",item.mime)?;
    if let Some(mut reader) = body {
        io::copy(&mut reader, &mut stream)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::package;

    fn request(asset: &MovieAsset, method: &str, headers: &str) -> (String, Vec<u8>) {
        let (address, id) = asset
            .url
            .strip_prefix("http://")
            .unwrap()
            .split_once('/')
            .unwrap();
        let mut stream = TcpStream::connect(address).unwrap();
        write!(
            stream,
            "{method} /{id} HTTP/1.1\r\nHost: {address}\r\n{headers}\r\n"
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        let split = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let body = response.split_off(split + 4);
        (String::from_utf8(response).unwrap(), body)
    }

    #[test]
    fn archive_media_streams_only_its_own_bytes_and_inflates_on_demand() {
        use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pictures.pptx");
        let mut archive = ZipWriter::new(File::create(&path).unwrap());
        for (part, compression, bytes) in [
            (
                "ppt/media/stored.png",
                CompressionMethod::Stored,
                &b"stored-picture"[..],
            ),
            (
                "ppt/media/compressed.png",
                CompressionMethod::Deflated,
                &b"compressed-picture"[..],
            ),
        ] {
            archive
                .start_file(
                    part,
                    SimpleFileOptions::default().compression_method(compression),
                )
                .unwrap();
            archive.write_all(bytes).unwrap();
        }
        archive.finish().unwrap();
        let preview = package::preview(&package::read(&path).unwrap()).unwrap();
        let stored = &preview.media["ppt/media/stored.png"];
        let compressed = &preview.media["ppt/media/compressed.png"];
        assert!(matches!(
            entry(&stored.token).unwrap().backing,
            MediaBacking::Stored { .. }
        ));
        let asset = entry(&compressed.token).unwrap();
        let MediaBacking::Compressed { extracted, .. } = &asset.backing else {
            panic!("Expected a compressed member")
        };
        assert!(extracted.lock().unwrap().is_none());
        let (headers, body) = request(compressed, "HEAD", "");
        assert!(headers.contains("Content-Length: 18"));
        assert!(body.is_empty());
        assert!(extracted.lock().unwrap().is_none());
        assert_eq!(request(stored, "GET", "").1, b"stored-picture");
        assert_eq!(
            request(stored, "GET", "Range: bytes=7-9999\r\n").1,
            b"picture"
        );
        assert!(request(stored, "GET", "Range: bytes=20-\r\n")
            .0
            .contains("416 Range Not Satisfiable"));
        assert_eq!(
            request(compressed, "GET", "Range: bytes=-7\r\n").1,
            b"picture"
        );
        assert!(extracted.lock().unwrap().is_some());
        release_movies(vec![stored.token.clone(), compressed.token.clone()]);
        assert!(open_file(&stored.token).is_err());
        assert!(request(compressed, "GET", "").0.contains("404 Not Found"));
    }

    #[test]
    fn dropped_movie_streams_seeks_and_reopens_from_powerpoint() {
        let source = std::env::var_os("PURE_POINT_TEST_MOVIE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/two-seconds.mp4")
            });
        let size = fs::metadata(&source).unwrap().len();
        let id = start_movie_upload("phone.MOV".into(), size).unwrap();
        let mut input = File::open(source).unwrap();
        let mut offset = 0;
        let mut block = vec![0; 1024 * 1024];
        while let Ok(n) = input.read(&mut block) {
            if n == 0 {
                break;
            }
            append(&id, offset, &block[..n]).unwrap();
            offset += n as u64;
        }
        let movie = tauri::async_runtime::block_on(finish_movie_upload(id)).unwrap();
        assert!(
            movie.w > 0. && movie.h > 0. && movie.poster.starts_with("data:image/png;base64,iVBOR")
        );
        let cached = entry(&movie.asset.token).unwrap();
        let size = cached.size;
        let (headers, body) = request(&movie.asset, "GET", "Range: bytes=0-15\r\n");
        assert!(headers.contains(&format!("Content-Range: bytes 0-15/{size}")));
        assert_eq!(&body[4..8], b"ftyp");
        let mut changes = package::Changes::default();
        let name = "ppt/media/phone.mp4".to_owned();
        changes
            .video_files
            .insert(name.clone(), movie.asset.token.clone());
        let dir = new_dir().unwrap();
        let out = dir.path().join("movie.pptx");
        package::save(&out, None, changes).unwrap();
        let reopened = package::preview(&package::read(&out).unwrap()).unwrap();
        let embedded = &reopened.media[&name];
        let mut a = open_file(&movie.asset.token).unwrap();
        let mut b = open_file(&embedded.token).unwrap();
        let mut second = vec![0; 1024 * 1024];
        while let Ok(n) = a.read(&mut block) {
            if n == 0 {
                break;
            }
            b.read_exact(&mut second[..n]).unwrap();
            assert_eq!(&block[..n], &second[..n]);
        }
        assert_eq!(b.read(&mut second).unwrap(), 0);

        release_movies(vec![movie.asset.token, embedded.token.clone()]);
    }
}
