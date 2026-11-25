use std::ffi::c_void;
use tauri::{App, Manager};

extern "C" {
    fn pp_install_magnification(view: *mut c_void);
}

pub fn install(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        window.with_webview(|web| {
            // Tauri runs this closure on the AppKit main thread and owns the WKWebView.
            unsafe { pp_install_magnification(web.inner()) }
        })?;
    }
    Ok(())
}
