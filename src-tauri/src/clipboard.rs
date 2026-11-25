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
