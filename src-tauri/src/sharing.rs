use base64::{engine::general_purpose::STANDARD, Engine};
use plist::{Dictionary, Value};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::{AppHandle, Manager, Url};
use uuid::Uuid;

const ROOT: &str = "Library/CloudStorage/OneDrive-電通";
const DOMAIN_ATTR: &str = "com.apple.file-provider-domain-id";
const STANDALONE: &str = "UBF8T346G9.OneDriveStandaloneSuite";
const APP_STORE: &str = "UBF8T346G9.OneDriveSyncClientSuite";

fn suite_for_domain(domain: &str) -> Option<&'static str> {
    match domain.trim_end() {
        "com.microsoft.OneDrive.FileProvider/OneDrive - 電通" => Some(STANDALONE),
        "com.microsoft.OneDrive-mac.FileProvider/OneDrive - 電通" => Some(APP_STORE),
        _ => None,
    }
}

fn relative_presentation(root: &Path, path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let file = path.canonicalize().ok()?;
    if !file.is_file() || !file.extension()?.eq_ignore_ascii_case("pptx") {
        return None;
    }
    Some(file.strip_prefix(root).ok()?.to_owned())
}

struct OneDriveFile {
    root: PathBuf,
    relative: PathBuf,
    suite: &'static str,
}

fn onedrive_file(home: &Path, path: &Path) -> Option<OneDriveFile> {
    let root = home.join(ROOT).canonicalize().ok()?;
    let relative = relative_presentation(&root, path)?;
    let output = Command::new("/usr/bin/xattr")
        .args(["-p", DOMAIN_ATTR])
        .arg(&root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let suite = suite_for_domain(std::str::from_utf8(&output.stdout).ok()?)?;
    Some(OneDriveFile {
        root,
        relative,
        suite,
    })
}

struct Account {
    tenant: Uuid,
    site: Url,
}

fn matching_account(account: &Dictionary, file: &OneDriveFile, group: &Path) -> Option<Account> {
    let string = |key: &str| account.get(key)?.as_string();
    if account.get("IsBusiness")?.as_boolean() != Some(true)
        || string("TenantDisplayName")? != "電通"
    {
        return None;
    }
    let mount = Path::new(string("UserFolder")?);
    let legacy = group.join("OneDrive - 電通.noindex/OneDrive - 電通");
    if mount != file.root && mount != legacy {
        return None;
    }

    // Scope keys are local OneDrive IDs. Identify this mount by path; Graph
    // resolves the authoritative library ID from the authenticated drive root.
    let logical = mount.join(&file.relative);
    let mappings = account
        .get("ScopeIdToMountPointPathCache")?
        .as_dictionary()?;
    let mut matches = mappings.values().filter_map(|path| {
        let path = Path::new(path.as_string()?);
        logical.starts_with(path).then_some(path)
    });
    let path = matches.next()?;
    if path != mount || matches.next().is_some() {
        return None;
    }
    let tenant = Uuid::parse_str(string("TenantId")?).ok()?;
    let mut site = Url::parse(string("ServiceEndpointUri")?).ok()?;
    let host = site.host_str()?;
    let parts: Vec<_> = site.path().trim_matches('/').split('/').collect();
    if site.scheme() != "https"
        || !host.ends_with("-my.sharepoint.com")
        || !site.username().is_empty()
        || site.password().is_some()
        || site.port().is_some()
        || site.query().is_some()
        || site.fragment().is_some()
        || parts.len() != 3
        || parts[0] != "personal"
        || parts[1].is_empty()
        || parts[2] != "_api"
    {
        return None;
    }
    let path = format!("/personal/{}", parts[1]);
    site.set_path(&path);
    Some(Account { tenant, site })
}

fn sync_account(home: &Path, file: &OneDriveFile) -> Option<Account> {
    let group = home.join("Library/Group Containers").join(file.suite);
    let prefs = group
        .join("Library/Preferences")
        .join(format!("{}.plist", file.suite));
    let plist = Value::from_file(prefs).ok()?;
    let mut accounts = plist.as_dictionary()?.iter().filter_map(|(key, value)| {
        if !key.starts_with("AccountInfo_Business") {
            return None;
        }
        matching_account(value.as_dictionary()?, file, &group)
    });
    let account = accounts.next()?;
    accounts.next().is_none().then_some(account)
}

fn powershell() -> Option<&'static str> {
    [
        "/usr/local/bin/pwsh",
        "/opt/homebrew/bin/pwsh",
        "/usr/local/microsoft/powershell/7/pwsh",
    ]
    .into_iter()
    .find(|path| Path::new(path).is_file())
}

fn shell(path: &str) -> Command {
    let mut cmd = Command::new(path);
    cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
    cmd.env("POWERSHELL_TELEMETRY_OPTOUT", "1");
    cmd
}

fn graph_installed() -> bool {
    powershell().is_some_and(|pwsh| {
        shell(pwsh)
            .arg("if (!(Get-Module -ListAvailable Microsoft.Graph.Authentication)) { exit 1 }")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    })
}

#[tauri::command]
pub async fn share_document_mode(app: AppHandle, path: PathBuf) -> &'static str {
    let Ok(home) = app.path().home_dir() else {
        return "none";
    };
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = onedrive_file(&home, &path) else {
            return "none";
        };
        if powershell().is_some() && sync_account(&home, &file).is_some() && graph_installed() {
            "graph"
        } else {
            "finder"
        }
    })
    .await
    .unwrap_or("none")
}

fn require_file(app: &AppHandle, path: &Path) -> Result<(PathBuf, OneDriveFile), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let file = onedrive_file(&home, path)
        .ok_or("Choose a saved PowerPoint file inside the Dentsu OneDrive folder.")?;
    Ok((home, file))
}

#[tauri::command]
pub async fn reveal_share_document(app: AppHandle, path: PathBuf) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_, file) = require_file(&app, &path)?;
        let status = Command::new("/usr/bin/open")
            .arg("-R")
            .arg(file.root.join(file.relative))
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not reveal this file in Finder.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// OneDrive for Business provides a 160-bit QuickXorHash. Compare it and the
// length with the looked-up item before changing any sharing permissions.
fn sync_hash(mut input: impl Read) -> std::io::Result<(u64, String)> {
    let mut buf = [0; 64 * 1024];
    let mut hash = [0u8; 20];
    let mut bit = 0;
    let mut size = 0u64;
    loop {
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        for &byte in &buf[..n] {
            let shifted = (byte as u16) << (bit % 8);
            hash[bit / 8] ^= shifted as u8;
            hash[(bit / 8 + 1) % 20] ^= (shifted >> 8) as u8;
            bit = (bit + 11) % 160;
        }
    }
    for (byte, length) in hash[12..].iter_mut().zip(size.to_le_bytes()) {
        *byte ^= length;
    }
    Ok((size, STANDARD.encode(hash)))
}

#[tauri::command]
pub async fn copy_organization_link(app: AppHandle, path: PathBuf) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || share_to_clipboard(&app, &path))
        .await
        .map_err(|e| e.to_string())?
}

fn share_to_clipboard(app: &AppHandle, path: &Path) -> Result<(), String> {
    let (home, file) = require_file(app, path)?;
    let account = sync_account(&home, &file)
        .ok_or("Could not verify the OneDrive account and library. Share this file from Finder.")?;
    let pwsh = powershell()
        .ok_or("Microsoft Graph PowerShell is unavailable. Share this file from Finder.")?;
    let bytes = File::open(file.root.join(&file.relative)).map_err(|e| e.to_string())?;
    let (size, hash) = sync_hash(bytes).map_err(|e| e.to_string())?;
    let result = shell(pwsh)
        .arg(include_str!("../native/onedrive-link.ps1"))
        .env("PURE_POINT_SHARE_TENANT", account.tenant.to_string())
        .env("PURE_POINT_SHARE_SITE", account.site.as_str())
        .env("PURE_POINT_SHARE_PATH", file.relative)
        .env("PURE_POINT_SHARE_SIZE", size.to_string())
        .env("PURE_POINT_SHARE_HASH", hash)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(match result.status.code() {
                Some(20) => "Microsoft sign-in or permission to share was unavailable. You can also share from Finder.",
                Some(21) => "Could not verify this file in the signed-in Dentsu OneDrive library. Wait for OneDrive to sync, or share from Finder.",
                Some(22) => "The saved file has not finished syncing to OneDrive. Try again after sync completes.",
                _ => "OneDrive did not return an organization-only edit link. Check your sharing settings in Finder.",
            }.into());
    }
    let text = std::str::from_utf8(&result.stdout)
        .ok()
        .map(str::trim)
        .unwrap_or_default();
    let link = Url::parse(text).map_err(|_| "The sharing link could not be verified.")?;
    if text.chars().any(char::is_whitespace)
        || link.scheme() != "https"
        || link.host_str() != account.site.host_str()
        || !link.username().is_empty()
        || link.password().is_some()
        || link.port().is_some()
    {
        return Err("The sharing link could not be verified.".into());
    }
    let mut copy = Command::new("/usr/bin/pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let written = copy.stdin.take().unwrap().write_all(text.as_bytes());
    let status = copy.wait().map_err(|e| e.to_string())?;
    written.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Could not copy the sharing link to the clipboard.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn only_existing_presentations_inside_the_verified_mount_are_eligible() {
        let dir = tempfile::tempdir().unwrap();
        let mount = dir.path().join("OneDrive-電通");
        let other = dir.path().join("OneDrive-電通2");
        std::fs::create_dir(&mount).unwrap();
        std::fs::create_dir(&other).unwrap();
        for (folder, name) in [
            (&mount, "Valid.PPTX"),
            (&mount, "template.potx"),
            (&other, "Outside.pptx"),
        ] {
            std::fs::write(folder.join(name), b"data").unwrap();
        }
        symlink(&other, mount.join("alias")).unwrap();
        let mount = mount.canonicalize().unwrap();
        assert_eq!(
            relative_presentation(&mount, &mount.join("Valid.PPTX")).unwrap(),
            Path::new("Valid.PPTX")
        );
        for path in [
            mount.join("template.potx"),
            mount.join("missing.pptx"),
            other.join("Outside.pptx"),
            mount.join("alias/Outside.pptx"),
        ] {
            assert!(relative_presentation(&mount, &path).is_none());
        }
        assert!(
            suite_for_domain("com.microsoft.OneDrive.FileProvider/OneDrive - Personal").is_none()
        );
        assert!(
            suite_for_domain("com.microsoft.OneDrive.FileProvider/OneDrive - 電通\n").is_some()
        );
    }

    #[test]
    fn hash_matches_onedrive_length_and_wraps_across_read_boundaries() {
        let input = b"abc";
        assert_eq!(
            sync_hash(input.as_slice()).unwrap(),
            (3, "YRDDGAAAAAAAAAAAAwAAAAAAAAA=".to_string())
        );
        let data: Vec<u8> = (0..66000).map(|i| i as u8).collect();
        assert_eq!(
            sync_hash(&data[..]).unwrap(),
            (66000, "olEClI2YubhU/WsA1bY9CLXFVe8=".to_string())
        );
    }
}
