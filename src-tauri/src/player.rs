use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::AppHandle;

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

// In a tauri:// WebView WebKit strips the HTTP referrer YouTube requires.
// Serve only this player's fixed HTML on loopback so WebKit supplies a real
// origin, and identify the embedding application with widget_referrer.
fn player_response(id: &str, app_id: &str) -> String {
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube video</title><style>html,body,iframe{{border:0;margin:0;width:100%;height:100%;overflow:hidden;background:#191b20}}</style></head><body><iframe title="YouTube video" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen src="https://www.youtube.com/embed/{id}?autoplay=1&amp;playsinline=1&amp;widget_referrer=https%3A%2F%2F{app_id}%2F"></iframe></body></html>"#
    )
}

fn respond(mut stream: TcpStream, host: &str, token: &str, app_id: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let mut reader = BufReader::new((&stream).take(8192));
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut request = line.split_whitespace();
    let method = request.next().unwrap_or("");
    let path = request.next().unwrap_or("");
    let id = path
        .strip_prefix(token)
        .and_then(|p| p.strip_prefix('/'))
        .filter(|id| video_id(id));
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
    let (status, body) = match (method, local, id) {
        ("GET", true, Some(id)) => ("200 OK", player_response(id, app_id)),
        _ => ("404 Not Found", String::new()),
    };
    write!(stream,"HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.youtube.com; base-uri 'none'; form-action 'none'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len())?;
    Ok(())
}

fn start(app_id: String) -> Result<PlayerHost, String> {
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
                let _ = respond(socket, &host, &route, &app_id);
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
        *slot = Some(start(app.config().identifier.clone())?);
    }
    let host = slot.as_ref().unwrap();
    Ok(format!("http://{}{}/{}", host.address, host.token, id))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serves_only_valid_video_urls_on_the_local_origin() {
        let host = start("studio.puretools.pure-point".into()).unwrap();
        for (path, authority, status) in [
            (
                format!("{}/M7lc1UVf-VE", host.token),
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
                assert!(response.contains("https://www.youtube.com/embed/M7lc1UVf-VE"));
            }
        }
    }
}
