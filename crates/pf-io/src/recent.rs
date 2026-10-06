//! Recent-files list: a small JSON file (`{ "recent": [...] }`), most recent first,
//! capped at [`MAX_RECENT`] entries, LRU on re-open.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::Result;

/// Maximum entries kept.
pub const MAX_RECENT: usize = 20;

#[derive(Debug, Default, Serialize, Deserialize)]
struct RecentFile {
    #[serde(default)]
    recent: Vec<String>,
}

/// Load the list. A missing or unreadable file yields an empty list (it is a cache).
pub fn load(path: &Path) -> Vec<String> {
    let Ok(bytes) = std::fs::read(path) else {
        return Vec::new();
    };
    serde_json::from_slice::<RecentFile>(&bytes)
        .map(|f| f.recent)
        .unwrap_or_default()
}

/// Persist the list (creating parent directories).
pub fn save(path: &Path, list: &[String]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = RecentFile {
        recent: list.iter().take(MAX_RECENT).cloned().collect(),
    };
    std::fs::write(path, serde_json::to_vec_pretty(&file)?)?;
    Ok(())
}

/// Move `entry` to the front (removing any existing copy) and truncate to [`MAX_RECENT`].
pub fn add(list: &mut Vec<String>, entry: &str) {
    list.retain(|e| !same_path(e, entry));
    list.insert(0, entry.to_owned());
    list.truncate(MAX_RECENT);
}

/// Remove `entry` if present.
pub fn remove(list: &mut Vec<String>, entry: &str) {
    list.retain(|e| !same_path(e, entry));
}

/// Drop entries whose file no longer exists.
pub fn prune_missing(list: &mut Vec<String>) {
    list.retain(|e| Path::new(e).exists());
}

/// Path equality: exact on Unix, case-insensitive with `/` == `\` on Windows.
fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.replace('/', "\\")
            .eq_ignore_ascii_case(&b.replace('/', "\\"))
    } else {
        a == b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lru_dedupe_and_cap() {
        let mut list = Vec::new();
        for i in 0..25 {
            add(&mut list, &format!("C:/img/{i}.png"));
        }
        assert_eq!(list.len(), MAX_RECENT);
        assert_eq!(list[0], "C:/img/24.png");
        assert_eq!(list[MAX_RECENT - 1], "C:/img/5.png");

        // Re-adding moves to front without duplicating.
        add(&mut list, "C:/img/10.png");
        assert_eq!(list[0], "C:/img/10.png");
        assert_eq!(
            list.iter()
                .filter(|e| e.as_str() == "C:/img/10.png")
                .count(),
            1
        );
        assert_eq!(list.len(), MAX_RECENT);

        remove(&mut list, "C:/img/10.png");
        assert!(!list.iter().any(|e| e == "C:/img/10.png"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_dedupe_case_insensitively() {
        let mut list = vec!["C:\\Art\\A.png".to_owned()];
        add(&mut list, "c:/art/a.PNG");
        assert_eq!(list, vec!["c:/art/a.PNG".to_owned()]);
    }

    #[test]
    fn save_load_round_trip_and_missing_file() {
        let dir = std::env::temp_dir().join(format!("pf-io-recent-{}", uuid::Uuid::new_v4()));
        let path = dir.join("nested").join("recent.json");
        assert!(load(&path).is_empty());
        let list = vec!["a.png".to_owned(), "b.pfproj".to_owned()];
        save(&path, &list).expect("save");
        assert_eq!(load(&path), list);
        std::fs::write(&path, b"{not json").expect("corrupt");
        assert!(load(&path).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_drops_missing() {
        let mut list = vec!["Z:/definitely/not/here.png".to_owned()];
        prune_missing(&mut list);
        assert!(list.is_empty());
    }
}
