use std::ffi::c_void;
use tauri::WebviewWindow;

extern "C" {
    fn pp_install_magnification(view: *mut c_void);
}

pub fn install_window(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|web| unsafe { pp_install_magnification(web.inner()) })
}
