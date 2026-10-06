//! API-key storage: OS keychain first, obfuscated file as a fallback.
//!
//! * [`KeyringStore`] uses the `keyring` crate (Windows Credential Manager, macOS
//!   Keychain, Linux Secret Service via zbus). Service name `com.pixelforge.app`, user
//!   = provider id (`open_ai`, `x_ai`, `gemini`).
//! * [`FileStore`] writes `ai-keys.json` in the app config directory. Values are XORed
//!   with a keystream derived from a per-install random secret kept next to it in
//!   `ai-keys.secret`. **This is obfuscation, not encryption**: anyone who can read both
//!   files can recover the keys. It only exists so headless Linux boxes without a Secret
//!   Service still work and so keys are not stored as plain text by accident.
//! * [`AutoKeyStore`] tries the keyring and falls back to the file the first time the
//!   keyring reports a platform error.
//!
//! Key values are never logged; [`SecretString`] redacts `Debug`.

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::error::Error;
use crate::secret::SecretString;
use crate::types::ProviderId;

/// Keyring service name.
pub const KEYRING_SERVICE: &str = "com.pixelforge.app";
/// File-store file name.
pub const FILE_STORE_NAME: &str = "ai-keys.json";
/// File-store secret name.
pub const FILE_STORE_SECRET_NAME: &str = "ai-keys.secret";

/// Where API keys live.
pub trait KeyStore: Send + Sync {
    /// Fetch the key for `provider`, `Ok(None)` when absent.
    fn get(&self, provider: ProviderId) -> Result<Option<SecretString>, Error>;
    /// Store (or replace) the key for `provider`.
    fn set(&self, provider: ProviderId, key: &SecretString) -> Result<(), Error>;
    /// Remove the key for `provider` (no error when absent).
    fn delete(&self, provider: ProviderId) -> Result<(), Error>;
    /// Short backend label for diagnostics (`"keyring"`, `"file"`).
    fn backend(&self) -> &'static str;

    /// `true` when a non-empty key is stored.
    fn has(&self, provider: ProviderId) -> Result<bool, Error> {
        Ok(self.get(provider)?.is_some_and(|k| !k.is_empty()))
    }
}

// ---------------------------------------------------------------------------------
// OS keychain
// ---------------------------------------------------------------------------------

/// OS keychain-backed store.
#[derive(Debug, Clone)]
pub struct KeyringStore {
    service: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new(KEYRING_SERVICE)
    }
}

impl KeyringStore {
    /// Store under a custom service name (tests use a throwaway name).
    pub fn new(service: &str) -> Self {
        Self {
            service: service.to_owned(),
        }
    }

    /// Run a keyring call on a dedicated OS thread.
    ///
    /// keyring 3's Linux backend blocks on zbus internally and its docs say calling it
    /// from a tokio worker can deadlock; a fresh std thread sidesteps that everywhere.
    fn run<T, F>(&self, provider: ProviderId, f: F) -> Result<T, Error>
    where
        T: Send + 'static,
        F: FnOnce(keyring::Entry) -> keyring::Result<T> + Send + 'static,
    {
        let service = self.service.clone();
        let handle = std::thread::Builder::new()
            .name("pf-keyring".to_owned())
            .spawn(move || keyring::Entry::new(&service, provider.as_str()).and_then(f))
            .map_err(|e| Error::KeyStore(format!("cannot spawn keyring thread: {e}")))?;
        handle
            .join()
            .map_err(|_| Error::KeyStore("keyring thread panicked".to_owned()))?
            .map_err(|e| Error::KeyStore(format!("{} keychain: {e}", provider.vendor())))
    }
}

impl KeyStore for KeyringStore {
    fn get(&self, provider: ProviderId) -> Result<Option<SecretString>, Error> {
        self.run(provider, |entry| match entry.get_password() {
            Ok(p) => Ok(Some(SecretString::new(p))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e),
        })
    }

    fn set(&self, provider: ProviderId, key: &SecretString) -> Result<(), Error> {
        let value = key.expose().to_owned();
        self.run(provider, move |entry| entry.set_password(&value))
    }

    fn delete(&self, provider: ProviderId) -> Result<(), Error> {
        self.run(provider, |entry| match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e),
        })
    }

    fn backend(&self) -> &'static str {
        "keyring"
    }
}

// ---------------------------------------------------------------------------------
// Obfuscated file
// ---------------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct FileContents {
    #[serde(default = "FileContents::version")]
    version: u32,
    #[serde(default = "FileContents::note")]
    note: String,
    /// provider id -> base64(nonce || xor(plaintext, keystream)).
    #[serde(default)]
    keys: std::collections::BTreeMap<String, String>,
}

impl Default for FileContents {
    fn default() -> Self {
        Self {
            version: Self::version(),
            note: Self::note(),
            keys: std::collections::BTreeMap::new(),
        }
    }
}

impl FileContents {
    fn version() -> u32 {
        1
    }
    fn note() -> String {
        "Obfuscated with ai-keys.secret, NOT encrypted. Prefer the OS keychain.".to_owned()
    }
}

/// Obfuscated JSON file store (fallback when no keychain is available).
#[derive(Debug)]
pub struct FileStore {
    path: PathBuf,
    secret_path: PathBuf,
    lock: Mutex<()>,
}

impl FileStore {
    /// Store under `dir` (created on first write).
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join(FILE_STORE_NAME),
            secret_path: dir.join(FILE_STORE_SECRET_NAME),
            lock: Mutex::new(()),
        }
    }

    /// Path of the JSON file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn load(&self) -> Result<FileContents, Error> {
        match fs::read(&self.path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(FileContents::default()),
            Err(e) => Err(e.into()),
        }
    }

    fn save(&self, contents: &FileContents) -> Result<(), Error> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec_pretty(contents)?;
        write_private(&self.path, &json)?;
        Ok(())
    }

    /// Load the per-install secret, creating it on first use.
    fn secret(&self, create: bool) -> Result<Option<[u8; 32]>, Error> {
        match fs::read(&self.secret_path) {
            Ok(bytes) if bytes.len() == 32 => {
                let mut s = [0u8; 32];
                s.copy_from_slice(&bytes);
                Ok(Some(s))
            }
            Ok(_) => Err(Error::KeyStore(format!(
                "{} is corrupt (wrong length)",
                self.secret_path.display()
            ))),
            Err(e) if e.kind() == ErrorKind::NotFound => {
                if !create {
                    return Ok(None);
                }
                let s = random_32();
                if let Some(parent) = self.secret_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                write_private(&self.secret_path, &s)?;
                Ok(Some(s))
            }
            Err(e) => Err(e.into()),
        }
    }
}

impl KeyStore for FileStore {
    fn get(&self, provider: ProviderId) -> Result<Option<SecretString>, Error> {
        let _guard = self.lock.lock().map_err(|_| poisoned())?;
        let contents = self.load()?;
        let Some(encoded) = contents.keys.get(provider.as_str()) else {
            return Ok(None);
        };
        let Some(secret) = self.secret(false)? else {
            return Err(Error::KeyStore(
                "ai-keys.secret is missing; stored keys cannot be read".to_owned(),
            ));
        };
        let blob = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| Error::KeyStore(format!("corrupt key entry: {e}")))?;
        let plain = deobfuscate(&secret, &blob)?;
        Ok(Some(SecretString::new(plain)))
    }

    fn set(&self, provider: ProviderId, key: &SecretString) -> Result<(), Error> {
        let _guard = self.lock.lock().map_err(|_| poisoned())?;
        let secret = self
            .secret(true)?
            .ok_or_else(|| Error::KeyStore("could not create ai-keys.secret".to_owned()))?;
        let mut contents = self.load()?;
        let blob = obfuscate(&secret, key.expose().as_bytes());
        contents.keys.insert(
            provider.as_str().to_owned(),
            base64::engine::general_purpose::STANDARD.encode(blob),
        );
        self.save(&contents)
    }

    fn delete(&self, provider: ProviderId) -> Result<(), Error> {
        let _guard = self.lock.lock().map_err(|_| poisoned())?;
        let mut contents = self.load()?;
        if contents.keys.remove(provider.as_str()).is_some() {
            self.save(&contents)?;
        }
        Ok(())
    }

    fn backend(&self) -> &'static str {
        "file"
    }
}

fn poisoned() -> Error {
    Error::KeyStore("file store lock poisoned".to_owned())
}

/// Write a file readable only by the owner where the OS supports it.
fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    fs::write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// 32 random bytes from two v4 UUIDs (the crate already depends on `uuid`).
fn random_32() -> [u8; 32] {
    let mut out = [0u8; 32];
    out[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    out[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    out
}

/// xoshiro256** keystream seeded from the install secret XOR a per-entry nonce.
struct Xoshiro([u64; 4]);

impl Xoshiro {
    fn seeded(secret: &[u8; 32], nonce: u64) -> Self {
        let mut s = [0u64; 4];
        for (i, word) in s.iter_mut().enumerate() {
            let mut b = [0u8; 8];
            b.copy_from_slice(&secret[i * 8..i * 8 + 8]);
            *word = u64::from_le_bytes(b) ^ nonce.rotate_left((i as u32) * 16);
        }
        if s.iter().all(|w| *w == 0) {
            s[0] = 0x9E37_79B9_7F4A_7C15;
        }
        Self(s)
    }

    fn next_u64(&mut self) -> u64 {
        let s = &mut self.0;
        let result = s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(45);
        result
    }

    fn xor_in_place(&mut self, data: &mut [u8]) {
        for chunk in data.chunks_mut(8) {
            let ks = self.next_u64().to_le_bytes();
            for (b, k) in chunk.iter_mut().zip(ks.iter()) {
                *b ^= k;
            }
        }
    }
}

const BLOB_MAGIC: &[u8; 4] = b"PFK1";

/// `nonce(8) || xor(magic || plaintext)`.
fn obfuscate(secret: &[u8; 32], plain: &[u8]) -> Vec<u8> {
    let nonce_bytes: [u8; 8] = {
        let u = uuid::Uuid::new_v4();
        let mut n = [0u8; 8];
        n.copy_from_slice(&u.as_bytes()[..8]);
        n
    };
    let nonce = u64::from_le_bytes(nonce_bytes);
    let mut body = Vec::with_capacity(4 + plain.len());
    body.extend_from_slice(BLOB_MAGIC);
    body.extend_from_slice(plain);
    Xoshiro::seeded(secret, nonce).xor_in_place(&mut body);
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&body);
    out
}

fn deobfuscate(secret: &[u8; 32], blob: &[u8]) -> Result<String, Error> {
    if blob.len() < 12 {
        return Err(Error::KeyStore("corrupt key entry (too short)".to_owned()));
    }
    let mut nonce_bytes = [0u8; 8];
    nonce_bytes.copy_from_slice(&blob[..8]);
    let mut body = blob[8..].to_vec();
    Xoshiro::seeded(secret, u64::from_le_bytes(nonce_bytes)).xor_in_place(&mut body);
    if &body[..4] != BLOB_MAGIC {
        return Err(Error::KeyStore(
            "key entry does not match ai-keys.secret (wrong or replaced secret)".to_owned(),
        ));
    }
    String::from_utf8(body[4..].to_vec())
        .map_err(|_| Error::KeyStore("key entry is not valid UTF-8".to_owned()))
}

// ---------------------------------------------------------------------------------
// Keyring with file fallback
// ---------------------------------------------------------------------------------

/// Keyring first; switches to the file store the first time the keyring fails.
#[derive(Debug)]
pub struct AutoKeyStore {
    keyring: KeyringStore,
    file: FileStore,
    use_file: AtomicBool,
}

impl AutoKeyStore {
    /// Production store rooted at the app config directory.
    pub fn new(config_dir: &Path) -> Self {
        Self::with_stores(KeyringStore::default(), FileStore::new(config_dir))
    }

    /// Compose from explicit stores (tests).
    pub fn with_stores(keyring: KeyringStore, file: FileStore) -> Self {
        Self {
            keyring,
            file,
            use_file: AtomicBool::new(false),
        }
    }

    /// Force the file backend (e.g. `PF_KEYSTORE=file`).
    pub fn force_file(self) -> Self {
        self.use_file.store(true, Ordering::Relaxed);
        self
    }

    fn file_only(&self) -> bool {
        self.use_file.load(Ordering::Relaxed)
    }

    fn fall_back(&self, err: &Error) {
        if !self.file_only() {
            tracing::warn!(
                "OS keychain unavailable ({err}); falling back to the obfuscated file store"
            );
            self.use_file.store(true, Ordering::Relaxed);
        }
    }
}

impl KeyStore for AutoKeyStore {
    fn get(&self, provider: ProviderId) -> Result<Option<SecretString>, Error> {
        if !self.file_only() {
            match self.keyring.get(provider) {
                Ok(Some(k)) => return Ok(Some(k)),
                Ok(None) => {}
                Err(e) => self.fall_back(&e),
            }
        }
        // Also consult the file so keys written during a previous fallback are found.
        self.file.get(provider)
    }

    fn set(&self, provider: ProviderId, key: &SecretString) -> Result<(), Error> {
        if !self.file_only() {
            match self.keyring.set(provider, key) {
                Ok(()) => {
                    // Don't leave a stale copy in the file.
                    let _ = self.file.delete(provider);
                    return Ok(());
                }
                Err(e) => self.fall_back(&e),
            }
        }
        self.file.set(provider, key)
    }

    fn delete(&self, provider: ProviderId) -> Result<(), Error> {
        let mut first_err = None;
        if !self.file_only() {
            if let Err(e) = self.keyring.delete(provider) {
                self.fall_back(&e);
                first_err = Some(e);
            }
        }
        match self.file.delete(provider) {
            Ok(()) => Ok(()),
            Err(e) => Err(first_err.unwrap_or(e)),
        }
    }

    fn backend(&self) -> &'static str {
        if self.file_only() {
            "file"
        } else {
            "keyring"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obfuscation_round_trips_and_detects_wrong_secret() {
        let secret = random_32();
        let blob = obfuscate(&secret, b"sk-test-key-123");
        assert_ne!(&blob[8..], b"sk-test-key-123");
        assert_eq!(
            deobfuscate(&secret, &blob).expect("round trip"),
            "sk-test-key-123"
        );
        let other = random_32();
        assert!(deobfuscate(&other, &blob).is_err());
        assert!(deobfuscate(&secret, &blob[..5]).is_err());
        // Two encodings of the same value differ (nonce).
        assert_ne!(obfuscate(&secret, b"x"), obfuscate(&secret, b"x"));
    }
}
