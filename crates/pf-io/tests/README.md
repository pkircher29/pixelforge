# `crates/pf-io/tests` — `pf-io` PSD Import Integration Tests

Integration test suite verifying PSD layer, group, blend-mode, and flattened-file import in `pf-io`.

## Key Files

| File / Directory | Coverage |
|---|---|
| `psd_import.rs` | Tests `pf_io::psd::import_psd` and `pf_io::open_bytes` against layered and flattened PSD files, verifies fixture byte parity (`fixture_file_matches_generator`), and includes the `psd_writer` binary fixture generator (`write_fixture`). |
| `fixtures/` | Checked-in binary PSD test fixtures (`layers.psd`, `flat.psd`) and regeneration instructions (`fixtures/README.md`). |
