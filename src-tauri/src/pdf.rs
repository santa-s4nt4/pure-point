use rfd::AsyncFileDialog;
use std::ffi::{c_char, CStr, CString};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
unsafe extern "C" {
    fn pp_render_pdf(
        html: *const c_char,
        path: *const c_char,
        width: f64,
        height: f64,
        count: usize,
        error: *mut c_char,
        capacity: usize,
    ) -> i32;
}
fn render(path: &Path, html: String, width: f64, height: f64, count: usize) -> Result<(), String> {
    let tmp = NamedTempFile::new_in(path.parent().ok_or("Invalid PDF destination.")?)
        .map_err(|e| e.to_string())?;
    let html = CString::new(html).map_err(|_| "The document contains an invalid character.")?;
    let destination = CString::new(tmp.path().as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let mut error = [0i8; 1024];
    // The native call retains no pointers after it returns. Its main-queue
    // completion is signalled before the worker releases either CString.
    let ok = unsafe {
        pp_render_pdf(
            html.as_ptr(),
            destination.as_ptr(),
            width,
            height,
            count,
            error.as_mut_ptr(),
            error.len(),
        )
    };
    if ok == 0 {
        return Err(unsafe { CStr::from_ptr(error.as_ptr()) }
            .to_string_lossy()
            .into_owned());
    }
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn export_pdf(
    html: String,
    width: f64,
    height: f64,
    count: usize,
    name: String,
) -> Result<Option<PathBuf>, String> {
    if count == 0 || !width.is_finite() || !height.is_finite() || width <= 0. || height <= 0. {
        return Err("There are no printable pages.".into());
    }
    let Some(file) = AsyncFileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_file_name(name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        render(&path, html, width, height, count)?;
        Ok(Some(path))
    })
    .await
    .map_err(|e| e.to_string())?
}
