//! A string wrapper that never prints its contents.

use std::fmt;

/// An API key / OAuth token.
///
/// `Debug` and `Display` print `[REDACTED]`, and the type deliberately implements
/// neither `Serialize` nor `Deserialize`, so a secret cannot accidentally end up in a
/// log line, an IPC payload or a `.pfproj` manifest. Read it with [`SecretString::expose`]
/// only at the point where the HTTP header is built.
#[derive(Clone, Default)]
pub struct SecretString(String);

impl SecretString {
    /// Wrap a secret.
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Borrow the plaintext. Keep the borrow as short-lived as possible.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// `true` when the wrapped string is empty.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Length in bytes (useful for "key looks truncated" validation without exposing it).
    pub fn len(&self) -> usize {
        self.0.len()
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretString([REDACTED])")
    }
}

impl fmt::Display for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl From<String> for SecretString {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for SecretString {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_and_display_are_redacted() {
        let s = SecretString::new("sk-super-secret");
        assert_eq!(format!("{s:?}"), "SecretString([REDACTED])");
        assert_eq!(s.to_string(), "[REDACTED]");
        assert_eq!(s.expose(), "sk-super-secret");
        assert_eq!(s.len(), 15);
        assert!(!s.is_empty());
    }
}
