use base64::{engine::general_purpose::STANDARD, Engine};
use core_text::font;
use std::collections::HashMap;
use std::ffi::{c_char, CStr, OsStr};
use std::os::unix::ffi::OsStrExt;

pub fn office_aliases() -> HashMap<String, Vec<String>> {
    unsafe extern "C" {
        fn pp_register_office_fonts() -> *const c_char;
    }
    let path = unsafe { pp_register_office_fonts() };
    if path.is_null() {
        return HashMap::new();
    }
    // Office's GDI family table maps localized PPTX family names to the
    // PostScript faces used on Mac (e.g. 游ゴシック → YuGothic-Regular, ...).
    let path = OsStr::from_bytes(unsafe { CStr::from_ptr(path) }.to_bytes());
    let names: std::collections::BTreeMap<String, Vec<String>> =
        plist::from_file(path).unwrap_or_default();
    let mut aliases = HashMap::<String, Vec<String>>::new();
    for (name, faces) in names {
        for face in faces {
            aliases.entry(face).or_default().push(name.clone());
        }
    }
    aliases
}

// WebKit can restrict local() for user-installed fonts. Reassemble the selected
// Core Text face as an in-memory sfnt, including faces stored inside collections.
#[tauri::command]
pub async fn font_data(postscript: String) -> Result<String, String> {
    let face = font::new_from_name(&postscript, 12.).map_err(|_| "Font not found.")?;
    if face.postscript_name() != postscript {
        return Err("Font not found.".into());
    }
    let tags = face
        .get_available_font_tables()
        .ok_or("The selected font has no available font tables.")?;
    let mut tables: Vec<_> = tags
        .iter()
        .filter_map(|tag| face.get_font_table(*tag).map(|data| (*tag, data.to_vec())))
        .collect();
    tables.sort_by_key(|(tag, _)| *tag);
    let count = u16::try_from(tables.len()).map_err(|e| e.to_string())?;
    if count == 0 {
        return Err("The selected font is empty.".into());
    }
    let cff = tables
        .iter()
        .any(|(tag, _)| [*b"CFF ", *b"CFF2"].contains(&tag.to_be_bytes()));
    let mut result = Vec::new();
    result.extend_from_slice(if cff { b"OTTO" } else { b"\x00\x01\x00\x00" });
    let power = count.ilog2() as u16;
    let search = (1u16 << power) * 16;
    for field in [count, search, power, count * 16 - search] {
        result.extend(field.to_be_bytes());
    }
    result.resize(12 + tables.len() * 16, 0);
    let mut head = None;
    for (index, (tag, mut bytes)) in tables.into_iter().enumerate() {
        let start = result.len();
        if tag.to_be_bytes() == *b"head" && bytes.len() >= 12 {
            bytes[8..12].fill(0);
            head = Some(start + 8);
        }
        let len = bytes.len();
        bytes.resize(len.next_multiple_of(4), 0);
        let checksum = wordsum(&bytes);
        for (field, v) in [tag, checksum, start as u32, len as u32]
            .into_iter()
            .enumerate()
        {
            let offset = 12 + index * 16 + field * 4;
            result[offset..offset + 4].copy_from_slice(&v.to_be_bytes());
        }
        result.extend(bytes);
    }
    if let Some(h) = head {
        let adjustment = 0xb1b0afbau32.wrapping_sub(wordsum(&result));
        result[h..h + 4].copy_from_slice(&adjustment.to_be_bytes());
    }
    Ok(STANDARD.encode(result))
}
fn wordsum(bytes: &[u8]) -> u32 {
    bytes.as_chunks::<4>().0.iter().fold(0u32, |sum, word| {
        sum.wrapping_add(u32::from_be_bytes(*word))
    })
}
