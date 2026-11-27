use crate::Typeface;
use std::{path::PathBuf, process::Command};

#[tauri::command]
pub async fn system_fonts() -> Vec<Typeface> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut faces: Vec<_> = db
        .faces()
        .filter_map(|f| {
            let family = f.families.first()?.0.clone();
            let bold = f.weight.0 >= 600;
            let italic = f.style != fontdb::Style::Normal;
            let weight = match f.weight.0 {
                0..=150 => "Thin",
                151..=250 => "Extra Light",
                251..=350 => "Light",
                351..=450 => "Regular",
                451..=550 => "Medium",
                551..=650 => "Semibold",
                651..=750 => "Bold",
                751..=850 => "Extra Bold",
                _ => "Black",
            };
            let style = if italic && weight == "Regular" {
                "Italic".into()
            } else if italic {
                format!("{weight} Italic")
            } else {
                weight.to_owned()
            };
            Some(Typeface {
                full: if style == "Regular" {
                    family.clone()
                } else {
                    format!("{family} {style}")
                },
                family,
                style,
                postscript: f.post_script_name.clone(),
                bold,
                italic,
                weight: (f64::from(f.weight.0) - 400.) / 750.,
                aliases: f
                    .families
                    .iter()
                    .skip(1)
                    .map(|(name, _)| name.clone())
                    .collect(),
            })
        })
        .collect();
    faces.sort_by(|a, b| (&a.family, &a.style).cmp(&(&b.family, &b.style)));
    faces
}

pub fn onedrive_root() -> Option<PathBuf> {
    std::env::var_os("OneDriveCommercial")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

fn shared_file(path: PathBuf) -> Option<PathBuf> {
    let root = onedrive_root()?.canonicalize().ok()?;
    let file = path.canonicalize().ok()?;
    (file.starts_with(root) && file.is_file() && file.extension()?.eq_ignore_ascii_case("pptx"))
        .then_some(path)
}

#[tauri::command]
pub fn share_document_mode(path: PathBuf) -> &'static str {
    if shared_file(path).is_some() {
        "explorer"
    } else {
        "none"
    }
}

#[tauri::command]
pub fn reveal_share_document(path: PathBuf) -> Result<(), String> {
    let path = shared_file(path).ok_or("Choose a presentation in your work OneDrive folder.")?;
    let explorer =
        PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows folder not found.")?)
            .join("explorer.exe");
    Command::new(explorer)
        .arg("/select,")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
