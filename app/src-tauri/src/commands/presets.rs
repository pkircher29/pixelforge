//! User pattern and brush-tip assets, stored independently of settings and projects.
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{CommandError, CommandResult};

const MAGIC: &[u8] = b"PFPRESET1\n";
const MAX_PIXELS: usize = 4096 * 4096;
const MAX_HEADER: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PresetKind {
    Patterns,
    Brushes,
}

impl PresetKind {
    fn folder(self) -> &'static str {
        match self {
            Self::Patterns => "patterns",
            Self::Brushes => "brushes",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetMeta {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub settings: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PresetAsset {
    #[serde(flatten)]
    pub meta: PresetMeta,
    pub pixels: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct PresetList {
    pub assets: Vec<PresetAsset>,
    pub errors: Vec<String>,
}

fn invalid(message: &str) -> CommandError {
    CommandError::new("invalid_preset", message)
}

fn validate_id(id: &str) -> CommandResult<()> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(invalid(
            "Preset ID must contain only letters, digits, hyphens or underscores",
        ));
    }
    Ok(())
}

fn validate(asset: &PresetAsset) -> CommandResult<()> {
    validate_id(&asset.meta.id)?;
    let count = u64::from(asset.meta.width) * u64::from(asset.meta.height);
    if count == 0 || count > MAX_PIXELS as u64 || count * 4 != asset.pixels.len() as u64 {
        return Err(invalid(
            "Preset dimensions and RGBA pixels do not match, or exceed 16 megapixels",
        ));
    }
    if asset.meta.name.trim().is_empty() || asset.meta.name.len() > 512 {
        return Err(invalid("Preset name must contain 1 to 512 bytes"));
    }
    Ok(())
}

fn asset_path(root: &Path, kind: PresetKind, id: &str) -> CommandResult<PathBuf> {
    validate_id(id)?;
    Ok(root.join(kind.folder()).join(format!("{id}.pfpreset")))
}

fn save(root: &Path, kind: PresetKind, asset: &PresetAsset) -> CommandResult<()> {
    validate(asset)?;
    let header = serde_json::to_vec(&asset.meta)?;
    if header.len() > MAX_HEADER {
        return Err(invalid("Preset metadata is too large"));
    }
    let path = asset_path(root, kind, &asset.meta.id)?;
    std::fs::create_dir_all(path.parent().unwrap())?;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> CommandResult<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(MAGIC)?;
        file.write_all(&(header.len() as u32).to_le_bytes())?;
        file.write_all(&header)?;
        file.write_all(&asset.pixels)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, &path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn read(path: &Path) -> CommandResult<PresetAsset> {
    if std::fs::metadata(path)?.len() > (MAX_PIXELS * 4 + MAX_HEADER + MAGIC.len() + 4) as u64 {
        return Err(invalid("Preset file is too large"));
    }
    let bytes = std::fs::read(path)?;
    let prefix = MAGIC.len() + 4;
    if bytes.len() < prefix || !bytes.starts_with(MAGIC) {
        return Err(invalid("Unknown preset format"));
    }
    let n = u32::from_le_bytes(bytes[MAGIC.len()..prefix].try_into().unwrap()) as usize;
    if n > MAX_HEADER || prefix + n > bytes.len() {
        return Err(invalid("Truncated preset metadata"));
    }
    let asset = PresetAsset {
        meta: serde_json::from_slice(&bytes[prefix..prefix + n])?,
        pixels: bytes[prefix + n..].to_vec(),
    };
    validate(&asset)?;
    if path.file_stem().and_then(|s| s.to_str()) != Some(&asset.meta.id) {
        return Err(invalid("Preset ID does not match its filename"));
    }
    Ok(asset)
}

fn list(root: &Path, kind: PresetKind) -> CommandResult<PresetList> {
    let entries = match std::fs::read_dir(root.join(kind.folder())) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PresetList {
                assets: vec![],
                errors: vec![],
            })
        }
        Err(e) => return Err(e.into()),
    };
    let mut result = PresetList {
        assets: vec![],
        errors: vec![],
    };
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file()
            || entry.path().extension().and_then(|s| s.to_str()) != Some("pfpreset")
        {
            continue;
        }
        match read(&entry.path()) {
            Ok(asset) => result.assets.push(asset),
            Err(e) => result.errors.push(format!(
                "{}: {}",
                entry.file_name().to_string_lossy(),
                e.message
            )),
        }
    }
    result.assets.sort_by(|a, b| {
        a.meta
            .name
            .cmp(&b.meta.name)
            .then(a.meta.id.cmp(&b.meta.id))
    });
    Ok(result)
}

#[tauri::command]
pub async fn presets_list(app: AppHandle, kind: PresetKind) -> CommandResult<PresetList> {
    let root = app.path().app_data_dir()?;
    tauri::async_runtime::spawn_blocking(move || list(&root, kind))
        .await
        .map_err(|e| CommandError::new("preset_io", e.to_string()))?
}

#[tauri::command]
pub async fn presets_save(
    app: AppHandle,
    kind: PresetKind,
    asset: PresetAsset,
) -> CommandResult<()> {
    let root = app.path().app_data_dir()?;
    tauri::async_runtime::spawn_blocking(move || save(&root, kind, &asset))
        .await
        .map_err(|e| CommandError::new("preset_io", e.to_string()))?
}

#[tauri::command]
pub async fn presets_remove(app: AppHandle, kind: PresetKind, id: String) -> CommandResult<()> {
    let path = asset_path(&app.path().app_data_dir()?, kind, &id)?;
    tauri::async_runtime::spawn_blocking(move || match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    })
    .await
    .map_err(|e| CommandError::new("preset_io", e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> PresetAsset {
        PresetAsset {
            meta: PresetMeta {
                id: "test-tip".into(),
                name: "Custom tip".into(),
                width: 2,
                height: 1,
                settings: Some(serde_json::json!({"size": 12})),
            },
            pixels: vec![0, 0, 0, 255, 100, 50, 25, 128],
        }
    }
    #[test]
    fn assets_survive_reload_and_replacement() {
        let root = tempfile::tempdir().unwrap();
        let mut asset = sample();
        save(root.path(), PresetKind::Brushes, &asset).unwrap();
        assert_eq!(
            list(root.path(), PresetKind::Brushes).unwrap().assets,
            vec![asset.clone()]
        );
        asset.meta.name = "Renamed".into();
        asset.pixels[0] = 42;
        save(root.path(), PresetKind::Brushes, &asset).unwrap();
        assert_eq!(
            list(root.path(), PresetKind::Brushes).unwrap().assets,
            vec![asset]
        );
        assert!(list(root.path(), PresetKind::Patterns)
            .unwrap()
            .assets
            .is_empty());
    }
    #[test]
    fn rejects_escape_paths_and_invalid_raster_without_replacing_good_data() {
        let root = tempfile::tempdir().unwrap();
        let mut asset = sample();
        save(root.path(), PresetKind::Patterns, &asset).unwrap();
        asset.pixels.pop();
        assert!(save(root.path(), PresetKind::Patterns, &asset).is_err());
        assert_eq!(
            list(root.path(), PresetKind::Patterns).unwrap().assets,
            vec![sample()]
        );
        for id in ["../escape", "C:\\escape", "", "a/b", "a.b"] {
            assert!(asset_path(root.path(), PresetKind::Brushes, id).is_err());
        }
    }
    #[test]
    fn reports_corruption_while_loading_other_assets() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), PresetKind::Patterns, &sample()).unwrap();
        std::fs::write(root.path().join("patterns/broken.pfpreset"), b"broken").unwrap();
        let result = list(root.path(), PresetKind::Patterns).unwrap();
        assert_eq!(result.assets.len(), 1);
        assert_eq!(result.errors.len(), 1);
    }
}
