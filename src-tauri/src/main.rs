#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod fonts;
mod gestures;
mod movies;
mod package;
mod pdf;
mod player;

use core_text::{
    font_collection,
    font_descriptor::{SymbolicTraitAccessors, TraitAccessors},
};
use rfd::AsyncFileDialog;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::menu::{Menu, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct Documents {
    sources: Mutex<HashMap<u64, Arc<Vec<u8>>>>,
    sequence: AtomicU64,
    incoming: Mutex<Option<PathBuf>>,
    dirty: AtomicBool,
}
#[derive(Serialize)]
struct Opened {
    id: u64,
    path: PathBuf,
    parts: package::Preview,
}

#[tauri::command]
async fn open_document(
    state: State<'_, Documents>,
    incoming: bool,
) -> Result<Option<Opened>, String> {
    let path = if incoming {
        state.incoming.lock().unwrap().take()
    } else {
        AsyncFileDialog::new()
            .add_filter("PowerPoint", &["pptx"])
            .pick_file()
            .await
            .map(|f| f.path().to_owned())
    };
    let Some(path) = path else { return Ok(None) };
    read_document(&state, path).map(Some)
}
fn read_document(state: &Documents, path: PathBuf) -> Result<Opened, String> {
    let bytes = package::read(&path)?;
    let parts = package::preview(&bytes)?;
    let id = state.sequence.fetch_add(1, Ordering::Relaxed);
    state.sources.lock().unwrap().insert(id, Arc::new(bytes));
    Ok(Opened { id, path, parts })
}
#[tauri::command]
async fn open_template(
    app: AppHandle,
    state: State<'_, Documents>,
) -> Result<Option<Opened>, String> {
    let path = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Library/CloudStorage/OneDrive-電通/zero/template.potx");
    match std::fs::metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not access {}: {e}", path.display())),
        Ok(_) => {}
    }
    read_document(&state, path.clone()).map(Some).map_err(|e| {
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
    state: State<'_, Documents>,
    source: Option<u64>,
    path: Option<PathBuf>,
    name: String,
    changes: package::Changes,
) -> Result<Option<PathBuf>, String> {
    let path = match path {
        Some(p) => p,
        None => match AsyncFileDialog::new()
            .add_filter("PowerPoint", &["pptx"])
            .set_file_name(name)
            .save_file()
            .await
        {
            Some(f) => f.path().to_owned(),
            None => return Ok(None),
        },
    };
    let bytes = match source {
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
    package::save(&path, bytes.as_ref().map(|b| b.as_slice()), changes)?;
    Ok(Some(path))
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
}
#[tauri::command]
async fn system_fonts() -> Vec<Typeface> {
    unsafe extern "C" {
        fn pp_register_yu_gothic();
    }
    unsafe {
        pp_register_yu_gothic();
    }
    let mut result = Vec::new();
    if let Some(faces) = font_collection::create_for_all_families().get_descriptors() {
        for face in faces.iter() {
            let traits = face.traits();
            let flags = traits.symbolic_traits();
            result.push(Typeface {
                bold: flags.is_bold(),
                italic: flags.is_italic(),
                weight: traits.normalized_weight(),
                family: face.family_name(),
                style: face.style_name(),
                postscript: face.font_name(),
                full: face.display_name(),
            });
        }
    }
    result.sort_by(|a, b| (&a.family, &a.style).cmp(&(&b.family, &b.style)));
    result
}
#[tauri::command]
fn set_dirty(state: State<Documents>, dirty: bool) {
    state.dirty.store(dirty, Ordering::SeqCst);
}
#[tauri::command]
fn finish_quit(app: AppHandle, state: State<Documents>) {
    state.dirty.store(false, Ordering::SeqCst);
    app.exit(0);
}
fn main() {
    tauri::Builder::default()
        .manage(Documents::default())
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
            let _ = app.emit("editor-command", event.id().as_ref());
        })
        .on_window_event(|win, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if win.state::<Documents>().dirty.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = win.emit("editor-command", "quit");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            open_template,
            pdf::export_pdf,
            release_document,
            save_document,
            system_fonts,
            fonts::font_data,
            player::youtube_player_url,
            movies::pick_movie,
            movies::start_movie_upload,
            movies::append_movie_chunk,
            movies::finish_movie_upload,
            movies::cancel_movie_upload,
            movies::release_movies,
            set_dirty,
            finish_quit
        ])
        .build(tauri::generate_context!())
        .expect("pure-point could not start")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => movies::clear(),
            tauri::RunEvent::Opened { urls } => {
                if let Some(path) = urls.iter().filter_map(|u| u.to_file_path().ok()).find(|p| {
                    p.extension()
                        .is_some_and(|e| e.eq_ignore_ascii_case("pptx"))
                }) {
                    *app.state::<Documents>().incoming.lock().unwrap() = Some(path);
                    let _ = app.emit("editor-command", "incoming");
                }
            }
            tauri::RunEvent::ExitRequested { api, .. }
                if app.state::<Documents>().dirty.load(Ordering::SeqCst) =>
            {
                api.prevent_exit();
                let _ = app.emit("editor-command", "quit");
            }
            _ => {}
        });
}

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
