//! Installed font family discovery through the operating system's font service.
use crate::{CommandError, CommandResult};

fn installed_families() -> CommandResult<Vec<String>> {
    let mut families = font_kit::source::SystemSource::new()
        .all_families()
        .map_err(|e| CommandError::new("font_enumeration", e.to_string()))?;
    families.retain(|family| !family.trim().is_empty());
    families.sort();
    families.dedup();
    Ok(families)
}

#[tauri::command]
pub async fn fonts_list() -> CommandResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(installed_families)
        .await
        .map_err(|e| CommandError::new("font_enumeration", e.to_string()))?
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "requires a desktop host with installed fonts"]
    fn enumerates_installed_families() {
        let families = super::installed_families().unwrap();
        assert!(!families.is_empty());
        assert!(families.windows(2).all(|pair| pair[0] < pair[1]));
        println!("Enumerated {} installed font families", families.len());
    }
}
