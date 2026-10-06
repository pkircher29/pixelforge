//! File I/O commands (`io_*`). Owned by the `io-rust` wave; this scaffold ships one stub.

use pf_io::ImageFormat;
use serde::Serialize;

use crate::error::CommandResult;

/// Reply of [`io_ping`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IoPing {
    /// Always `"pong"`.
    pub reply: String,
    /// Extensions the open dialog should accept.
    pub import_extensions: Vec<String>,
    /// Extensions the export dialog should offer.
    pub export_extensions: Vec<String>,
}

/// Liveness probe for the IO layer; also hands the UI the supported extension lists.
#[tauri::command]
pub fn io_ping() -> CommandResult<IoPing> {
    let import_extensions = ImageFormat::ALL
        .iter()
        .filter(|f| f.can_import())
        .flat_map(|f| f.extensions().iter().map(|e| (*e).to_owned()))
        .collect();
    let export_extensions = ImageFormat::ALL
        .iter()
        .filter(|f| f.can_export())
        .map(|f| f.extension().to_owned())
        .collect();
    Ok(IoPing {
        reply: "pong".to_owned(),
        import_extensions,
        export_extensions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_reports_formats() {
        let p = io_ping().expect("ok");
        assert_eq!(p.reply, "pong");
        assert!(p.import_extensions.iter().any(|e| e == "psd"));
        assert!(!p.export_extensions.iter().any(|e| e == "psd"));
        assert!(p.export_extensions.iter().any(|e| e == "pfproj"));
    }
}
