use tauri::AppHandle;

use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::Duration,
};

struct PlayerHost {
    address: SocketAddr,
    token: String,
}
static HOST: Mutex<Option<PlayerHost>> = Mutex::new(None);

fn video_id(value: &str) -> bool {
    value.len() == 11
        && value
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || matches!(v, b'-' | b'_'))
}

const PLAYER_PAGE: &str = include_str!("../../public/youtube-player.html");
const PLAYER_SCRIPT: &str = include_str!("../../public/youtube-player.js");

// Serve just the player and its adapter on a tokenized loopback route. WebKit
// suppresses the HTTP Referer when the parent uses the app's custom scheme.
fn respond(mut stream: TcpStream, host: &str, token: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let mut reader = BufReader::new((&stream).take(8192));
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut request = line.split_whitespace();
    let method = request.next().unwrap_or("");
    let path = request.next().unwrap_or("");
    let resource = path.strip_prefix(token).and_then(|p| p.strip_prefix('/'));
    let mut local = false;
    let mut header = String::new();
    loop {
        header.clear();
        if reader.read_line(&mut header)? == 0 || header == "\r\n" {
            break;
        }
        if let Some((k, v)) = header.split_once(':') {
            if k.eq_ignore_ascii_case("host") {
                local = v.trim() == host;
            }
        }
    }
    let (status, mime, body) = match (method, local, resource) {
        ("GET", true, Some("youtube-player.js")) => ("200 OK", "text/javascript", PLAYER_SCRIPT),
        ("GET", true, Some(id)) if video_id(id) => ("200 OK", "text/html", PLAYER_PAGE),
        _ => ("404 Not Found", "text/plain", ""),
    };
    write!(stream,"HTTP/1.1 {status}\r\nContent-Type: {mime}; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline'; frame-src https://www.youtube.com; base-uri 'none'; form-action 'none'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len())?;
    Ok(())
}

fn start() -> Result<PlayerHost, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    let token = format!("/{}", u128::from_ne_bytes(bytes));
    let route = token.clone();
    thread::Builder::new()
        .name("youtube-player".into())
        .spawn(move || {
            let host = address.to_string();
            for socket in listener.incoming().flatten() {
                let _ = respond(socket, &host, &route);
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(PlayerHost { address, token })
}

#[tauri::command]
pub fn youtube_player_url(app: AppHandle, id: String) -> Result<String, String> {
    if !video_id(&id) {
        return Err("Invalid YouTube video ID.".into());
    }
    let mut slot = HOST
        .lock()
        .map_err(|_| "Unable to initialize the video player.")?;
    if slot.is_none() {
        *slot = Some(start()?);
    }
    let host = slot.as_ref().unwrap();
    Ok(format!(
        "http://{}{}/{}#app={}",
        host.address,
        host.token,
        id,
        app.config().identifier
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serves_only_valid_video_urls_on_the_local_origin() {
        let host = start().unwrap();
        for (path, authority, status) in [
            (
                format!("{}/M7lc1UVf-VE", host.token),
                host.address.to_string(),
                "200",
            ),
            (
                format!("{}/youtube-player.js", host.token),
                host.address.to_string(),
                "200",
            ),
            ("/unknown/anything".into(), host.address.to_string(), "404"),
            (
                format!("{}/M7lc1UVf-VE", host.token),
                "example.org".into(),
                "404",
            ),
        ] {
            let mut socket = TcpStream::connect(host.address).unwrap();
            write!(socket, "GET {path} HTTP/1.1\r\nHost: {authority}\r\n\r\n").unwrap();
            let mut response = String::new();
            socket.read_to_string(&mut response).unwrap();
            assert!(response.starts_with(&format!("HTTP/1.1 {status}")));
            if status == "200" {
                assert!(
                    response.contains("youtube-player.js") || response.contains("window.YT.Player")
                );
            }
        }
    }
}
