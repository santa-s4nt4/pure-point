use tauri::{
    Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};

const LABEL_PREFIX: &str = "presentation-";

#[tauri::command]
pub async fn open_presentation(window: WebviewWindow) -> Result<(), String> {
    if window.label().starts_with(LABEL_PREFIX) {
        return Err("Open a presentation from its editor.".into());
    }
    let app = window.app_handle();
    let label = format!("{LABEL_PREFIX}{}", window.label());
    let viewer = if let Some(viewer) = app.get_webview_window(&label) {
        viewer
    } else {
        WebviewWindowBuilder::new(
            app,
            label,
            WebviewUrl::App("index.html#presentation".into()),
        )
        .title("Presentation — pure-point")
        .inner_size(960., 600.)
        .disable_drag_drop_handler()
        .build()
        .map_err(|error| error.to_string())?
    };
    viewer.set_focus().map_err(|error| error.to_string())
}

// The viewer closes without the editor's save prompt and follows its owner's lifetime.
pub fn window_event(window: &Window, event: &WindowEvent) -> bool {
    if let Some(owner) = window.label().strip_prefix(LABEL_PREFIX) {
        if matches!(event, WindowEvent::Destroyed) {
            let _ = window.emit_to(owner, "presentation-closed", ());
        }
        return true;
    }
    if matches!(event, WindowEvent::Destroyed) {
        let label = format!("{LABEL_PREFIX}{}", window.label());
        if let Some(viewer) = window.app_handle().get_webview_window(&label) {
            let _ = viewer.destroy();
        }
    }
    false
}
