#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod clipboard;
#[cfg(target_os = "macos")]
mod fonts;
#[cfg(target_os = "macos")]
mod gestures;
mod movies;
mod package;
#[cfg(target_os = "macos")]
mod pdf;
mod player;
#[cfg(target_os = "macos")]
mod sharing;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "macos")]
use core_text::{
    font_collection,
    font_descriptor::{SymbolicTraitAccessors, TraitAccessors},
};
use rfd::AsyncFileDialog;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
struct Documents {
    sources: Mutex<HashMap<u64, Arc<package::Source>>>,
    sequence: AtomicU64,
    incoming: Mutex<HashMap<String, PathBuf>>,
    dirty: Mutex<HashSet<String>>,
}
#[derive(Serialize)]
struct Opened {
    id: u64,
    path: PathBuf,
    parts: package::Preview,
}

fn document_window(app: &AppHandle, path: Option<PathBuf>) -> Result<(), String> {
    let state = app.state::<Documents>();
    let label = format!(
        "document-{}",
        state.sequence.fetch_add(1, Ordering::Relaxed)
    );
    let mut config = app.config().app.windows[0].clone();
    config.label = label.clone();
    if let Some(path) = path {
        state.incoming.lock().unwrap().insert(label.clone(), path);
    }
    let result =
        WebviewWindowBuilder::from_config(app, &config).and_then(|builder| builder.build());
    let window = result.map_err(|e| {
        state.incoming.lock().unwrap().remove(&label);
        e.to_string()
    })?;
    #[cfg(target_os = "macos")]
    gestures::install_window(&window).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
async fn new_document_window(window: WebviewWindow, pick: bool) -> Result<(), String> {
    let path = if pick {
        let Some(file) = AsyncFileDialog::new()
            .set_parent(&window)
            .add_filter("PowerPoint", &["pptx"])
            .pick_file()
            .await
        else {
            return Ok(());
        };
        Some(file.path().to_owned())
    } else {
        None
    };
    document_window(window.app_handle(), path)
}

#[tauri::command]
async fn open_document(
    window: WebviewWindow,
    state: State<'_, Documents>,
) -> Result<Option<Opened>, String> {
    let path = state.incoming.lock().unwrap().remove(window.label());
    let Some(path) = path else { return Ok(None) };
    read_document(&state, path).await.map(Some)
}
async fn read_document(state: &Documents, path: PathBuf) -> Result<Opened, String> {
    let (path, source, parts) = tauri::async_runtime::spawn_blocking(move || {
        let source = package::read(&path)?;
        let parts = package::preview(&source)?;
        Ok::<_, String>((path, source, parts))
    })
    .await
    .map_err(|e| e.to_string())??;
    let id = state.sequence.fetch_add(1, Ordering::Relaxed);
    state.sources.lock().unwrap().insert(id, source);
    Ok(Opened { id, path, parts })
}
#[tauri::command]
async fn open_template(
    #[allow(unused_variables)] app: AppHandle,
    state: State<'_, Documents>,
) -> Result<Option<Opened>, String> {
    #[cfg(target_os = "macos")]
    let path = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Library/CloudStorage/OneDrive-電通/zero/template.potx");
    #[cfg(windows)]
    let path = {
        let Some(root) = windows::onedrive_root() else {
            return Ok(None);
        };
        root.join("zero").join("template.potx")
    };
    match std::fs::metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not access {}: {e}", path.display())),
        Ok(_) => {}
    }
    read_document(&state, path.clone())
        .await
        .map(Some)
        .map_err(|e| {
            format!(
                "Could not open {}. Check that the template is available in OneDrive. {e}",
                path.display()
            )
        })
}
#[tauri::command]
fn release_document(state: State<Documents>, id: u64) {
    state.sources.lock().unwrap().remove(&id);
}

#[tauri::command]
async fn save_document(
    window: WebviewWindow,
    state: State<'_, Documents>,
    source: Option<u64>,
    path: Option<PathBuf>,
    name: String,
    changes: package::Changes,
) -> Result<Option<PathBuf>, String> {
    let path = match path {
        Some(p) => p,
        None => match AsyncFileDialog::new()
            .set_parent(&window)
            .add_filter("PowerPoint", &["pptx"])
            .set_file_name(name)
            .save_file()
            .await
        {
            Some(f) => f.path().to_owned(),
            None => return Ok(None),
        },
    };
    let source = match source {
        Some(id) => Some(
            state
                .sources
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or("The original document is no longer available.")?,
        ),
        None => None,
    };
    tauri::async_runtime::spawn_blocking(move || {
        package::save(&path, source.as_deref(), changes)?;
        Ok(Some(path))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Serialize)]
struct Typeface {
    bold: bool,
    italic: bool,
    weight: f64,
    family: String,
    style: String,
    postscript: String,
    full: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    aliases: Vec<String>,
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn system_fonts() -> Vec<Typeface> {
    let mut aliases = fonts::office_aliases();
    let mut result = Vec::new();
    if let Some(faces) = font_collection::create_for_all_families().get_descriptors() {
        for face in faces.iter() {
            let traits = face.traits();
            let flags = traits.symbolic_traits();
            let postscript = face.font_name();
            result.push(Typeface {
                bold: flags.is_bold(),
                italic: flags.is_italic(),
                weight: traits.normalized_weight(),
                family: face.family_name(),
                style: face.style_name(),
                aliases: aliases.remove(&postscript).unwrap_or_default(),
                postscript,
                full: face.display_name(),
            });
        }
    }
    result.sort_by(|a, b| (&a.family, &a.style).cmp(&(&b.family, &b.style)));
    result
}
#[tauri::command]
fn set_dirty(window: WebviewWindow, state: State<Documents>, dirty: bool) {
    let mut labels = state.dirty.lock().unwrap();
    if dirty {
        labels.insert(window.label().to_owned());
    } else {
        labels.remove(window.label());
    }
}
#[tauri::command]
fn finish_close(
    window: WebviewWindow,
    state: State<Documents>,
    quitting: bool,
) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())?;
    state.dirty.lock().unwrap().remove(window.label());
    if quitting {
        window.app_handle().exit(0);
    }
    Ok(())
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn sample_screen_color() -> Result<Option<String>, String> {
    extern "C" {
        fn pp_sample_screen_color() -> i32;
    }
    let rgb = tauri::async_runtime::spawn_blocking(|| unsafe { pp_sample_screen_color() })
        .await
        .map_err(|e| e.to_string())?;
    Ok((rgb >= 0).then(|| format!("#{rgb:06X}")))
}
fn main() {
    let documents = Documents::default();
    #[cfg(windows)]
    if let Some(path) = std::env::args_os().skip(1).map(PathBuf::from).find(|p| {
        p.extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pptx"))
    }) {
        documents
            .incoming
            .lock()
            .unwrap()
            .insert("main".into(), path);
    }
    let builder = tauri::Builder::default().manage(documents);
    #[cfg(target_os = "macos")]
    let builder = builder
        .setup(gestures::install)
        .menu(|app| {
            let app_menu = SubmenuBuilder::new(app, "pure-point")
                .hide()
                .quit_with_text("Quit pure-point")
                .build()?;
            let mut file = SubmenuBuilder::new(app, "File");
            for (id, title, accel) in [
                ("new", "New", "Cmd+N"),
                ("open", "Open…", "Cmd+O"),
                ("close", "Close Window", "Cmd+W"),
                ("save", "Save", "Cmd+S"),
                ("saveAs", "Save As…", "Cmd+Shift+S"),
                ("pdf", "Export PDF…", "Cmd+Shift+E"),
                ("present", "Present", "Cmd+Option+P"),
            ] {
                file = file.item(&MenuItem::with_id(app, id, title, true, Some(accel))?);
            }
            let edit = SubmenuBuilder::new(app, "Edit")
                .item(&MenuItem::with_id(
                    app,
                    "undo",
                    "Undo",
                    true,
                    Some("Cmd+Z"),
                )?)
                .item(&MenuItem::with_id(
                    app,
                    "redo",
                    "Redo",
                    true,
                    Some("Cmd+Shift+Z"),
                )?)
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            Menu::with_items(app, &[&app_menu, &file.build()?, &edit])
        })
        .on_menu_event(|app, event| {
            if let Some(window) = app
                .webview_windows()
                .into_values()
                .find(|w| w.is_focused().unwrap_or(false))
            {
                let _ = app.emit_to(window.label(), "editor-command", event.id().as_ref());
            }
        });
    builder
        .on_window_event(|win, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.emit_to(win.label(), "editor-command", "close");
            }
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(target_os = "macos")]
            clipboard::read_canvas_clipboard,
            clipboard::store_selection,
            clipboard::read_selection,
            new_document_window,
            open_document,
            open_template,
            #[cfg(target_os = "macos")]
            sharing::share_document_mode,
            #[cfg(target_os = "macos")]
            sharing::reveal_share_document,
            #[cfg(target_os = "macos")]
            sharing::copy_organization_link,
            #[cfg(target_os = "macos")]
            pdf::export_pdf,
            release_document,
            save_document,
            #[cfg(target_os = "macos")]
            system_fonts,
            #[cfg(target_os = "macos")]
            sample_screen_color,
            #[cfg(target_os = "macos")]
            fonts::font_data,
            #[cfg(windows)]
            windows::system_fonts,
            #[cfg(windows)]
            windows::share_document_mode,
            #[cfg(windows)]
            windows::reveal_share_document,
            player::youtube_player_url,
            movies::pick_movie,
            movies::start_movie_upload,
            movies::append_movie_chunk,
            movies::finish_movie_upload,
            movies::cancel_movie_upload,
            movies::release_movies,
            set_dirty,
            finish_close
        ])
        .build(tauri::generate_context!())
        .expect("pure-point could not start")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => {
                movies::clear();
                app.state::<Documents>().sources.lock().unwrap().clear();
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                for path in urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|p| {
                        p.extension()
                            .is_some_and(|e| e.eq_ignore_ascii_case("pptx"))
                    })
                {
                    if let Err(error) = document_window(app, Some(path)) {
                        eprintln!("Could not open presentation window: {error}");
                    }
                }
            }
            tauri::RunEvent::ExitRequested { api, .. } => {
                // Resolve one unsaved presentation at a time. Cancel in any window
                // stops the sequence and leaves the remaining presentations open.
                let label = app
                    .state::<Documents>()
                    .dirty
                    .lock()
                    .unwrap()
                    .iter()
                    .next()
                    .cloned();
                if let Some(window) = label.and_then(|l| app.get_webview_window(&l)) {
                    api.prevent_exit();
                    let _ = window.set_focus();
                    let _ = window.emit_to(window.label(), "editor-command", "quit");
                }
            }
            _ => {}
        });
}

#[cfg(target_os = "macos")]
#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::collections::HashSet;

    #[test]
    fn font_picker_covers_installed_faces_and_provides_local_font_data() {
        let faces = tauri::async_runtime::block_on(system_fonts());
        let names: HashSet<_> = faces.iter().map(|f| f.postscript.as_str()).collect();
        let missing: Vec<_> = font_collection::get_postscript_names()
            .iter()
            .map(|f| f.to_string())
            .filter(|name| !names.contains(name.as_str()))
            .collect();
        assert!(missing.is_empty(), "Missing Core Text faces: {missing:?}");
        let families: HashSet<_> = faces.iter().map(|f| &f.family).collect();
        println!("{} font families, {} faces", families.len(), names.len());
        let face = names.get("HelveticaNeue").unwrap();
        let encoded = tauri::async_runtime::block_on(fonts::font_data(face.to_string())).unwrap();
        let bytes = STANDARD.decode(encoded).unwrap();
        assert!(bytes.starts_with(b"OTTO") || bytes.starts_with(&[0, 1, 0, 0]));
        let checksum = bytes.as_chunks::<4>().0.iter().fold(0u32, |sum, word| {
            sum.wrapping_add(u32::from_be_bytes(*word))
        });
        assert_eq!(checksum, 0xb1b0afba);
    }
}
