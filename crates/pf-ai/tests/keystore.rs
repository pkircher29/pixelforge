use pf_ai::keystore::{
    AutoKeyStore, FileStore, KeyStore, KeyringStore, FILE_STORE_NAME, FILE_STORE_SECRET_NAME,
};
use pf_ai::{ProviderId, SecretString};

#[test]
fn file_store_round_trips_without_plaintext_on_disk() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = FileStore::new(dir.path());
    assert_eq!(store.backend(), "file");
    assert!(store.get(ProviderId::OpenAi).expect("get").is_none());
    assert!(!store.has(ProviderId::OpenAi).expect("has"));

    let key = SecretString::new("sk-live-SUPERSECRET-0123456789");
    store.set(ProviderId::OpenAi, &key).expect("set");
    store
        .set(ProviderId::Gemini, &SecretString::new("AIza-another"))
        .expect("set");

    let json = std::fs::read_to_string(dir.path().join(FILE_STORE_NAME)).expect("file exists");
    assert!(!json.contains("SUPERSECRET"), "plaintext leaked: {json}");
    assert!(!json.contains("AIza-another"));
    assert!(json.contains("NOT encrypted"), "warning note present");
    assert_eq!(
        std::fs::read(dir.path().join(FILE_STORE_SECRET_NAME))
            .expect("secret exists")
            .len(),
        32
    );

    let back = store.get(ProviderId::OpenAi).expect("get").expect("some");
    assert_eq!(back.expose(), key.expose());
    assert!(store.has(ProviderId::Gemini).expect("has"));
    assert!(store.get(ProviderId::XAi).expect("get").is_none());

    // Overwrite, then delete.
    store
        .set(
            ProviderId::OpenAi,
            &SecretString::new("sk-rotated-0123456789abcdef"),
        )
        .expect("set");
    assert_eq!(
        store
            .get(ProviderId::OpenAi)
            .expect("get")
            .expect("some")
            .expose(),
        "sk-rotated-0123456789abcdef"
    );
    store.delete(ProviderId::OpenAi).expect("delete");
    assert!(store.get(ProviderId::OpenAi).expect("get").is_none());
    store
        .delete(ProviderId::OpenAi)
        .expect("delete twice is fine");
    assert!(store.has(ProviderId::Gemini).expect("other key survives"));

    // A second store instance on the same dir reads the same values.
    let again = FileStore::new(dir.path());
    assert!(again.has(ProviderId::Gemini).expect("has"));

    // Replacing the secret makes stored entries unreadable (and says so).
    std::fs::write(dir.path().join(FILE_STORE_SECRET_NAME), [7u8; 32]).expect("write");
    let err = again.get(ProviderId::Gemini).expect_err("wrong secret");
    assert_eq!(err.code(), "ai_key_store");
    assert!(err.to_string().contains("ai-keys.secret"));
}

#[test]
fn file_store_tolerates_missing_or_corrupt_files() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = FileStore::new(dir.path().join("nested").join("deeper").as_path());
    store
        .set(ProviderId::XAi, &SecretString::new("xai-0123456789abcdef"))
        .expect("creates parent dirs");
    assert!(store.has(ProviderId::XAi).expect("has"));

    std::fs::write(store.path(), "{ not json").expect("corrupt");
    assert!(store.get(ProviderId::XAi).is_err());
}

#[test]
fn auto_store_forced_to_file_uses_file_backend() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Throwaway service name so even if the keyring were consulted nothing real is touched.
    let store = AutoKeyStore::with_stores(
        KeyringStore::new("com.pixelforge.test.never-used"),
        FileStore::new(dir.path()),
    )
    .force_file();
    assert_eq!(store.backend(), "file");
    store
        .set(ProviderId::Gemini, &SecretString::new("AIzaTEST0123456789"))
        .expect("set");
    assert!(dir.path().join(FILE_STORE_NAME).exists());
    assert_eq!(
        store
            .get(ProviderId::Gemini)
            .expect("get")
            .expect("some")
            .expose(),
        "AIzaTEST0123456789"
    );
    store.delete(ProviderId::Gemini).expect("delete");
    assert!(!store.has(ProviderId::Gemini).expect("has"));
}

#[test]
fn secret_string_never_prints_in_errors_or_debug() {
    let key = SecretString::new("sk-SHOULD-NOT-APPEAR");
    assert!(!format!("{key:?}").contains("SHOULD"));
    assert!(!format!("{key}").contains("SHOULD"));
    let auth = pf_ai::AuthMethod::ApiKey(key);
    assert!(!format!("{auth:?}").contains("SHOULD"));
}
