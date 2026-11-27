use std::ffi::{c_char, c_void, CStr};
use tauri::ipc::Response;

unsafe extern "C" {
    fn pp_read_canvas_clipboard() -> *mut c_char;
    fn free(ptr: *mut c_void);
}

#[tauri::command]
pub async fn read_canvas_clipboard() -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // The native reader returns UTF-8 JSON allocated with strndup.
        let ptr = unsafe { pp_read_canvas_clipboard() };
        if ptr.is_null() {
            return Err("Could not read the Mac clipboard.".to_owned());
        }
        let json = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { free(ptr.cast()) };
        Ok(Response::new(json))
    })
    .await
    .map_err(|error| error.to_string())?
}

// The pasteboard carries a token. Keep its slide data in this process and
// retain the original disk-backed media while another window may paste it.
struct Selection {
    token: String,
    json: String,
    media: Vec<String>,
}
static SELECTION: std::sync::Mutex<Option<Selection>> = std::sync::Mutex::new(None);

#[tauri::command]
pub fn store_selection(token: String, json: String, media: Vec<String>) -> Result<(), String> {
    crate::movies::retain_movies(&media)?;
    let previous = SELECTION
        .lock()
        .unwrap()
        .replace(Selection { token, json, media });
    if let Some(old) = previous {
        crate::movies::release_movies(old.media);
    }
    Ok(())
}

#[tauri::command]
pub fn read_selection(token: String) -> Result<Option<String>, String> {
    let selection = SELECTION.lock().unwrap();
    let Some(copy) = selection.as_ref().filter(|c| c.token == token) else {
        return Ok(None);
    };
    crate::movies::retain_movies(&copy.media)?;
    Ok(Some(copy.json.clone()))
}
