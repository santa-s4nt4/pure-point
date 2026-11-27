use std::ffi::c_void;
use tauri::{App, Manager, WebviewWindow};

extern "C" {
    fn pp_install_magnification(view: *mut c_void);
}

pub fn install(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        install_window(&window)?;
    }
    Ok(())
}

pub fn install_window(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|web| unsafe { pp_install_magnification(web.inner()) })
}
