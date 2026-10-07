//! IPC surface. One module per PLAN.md owner: `ai` (ai-rust wave), `io` (io-rust wave),
//! `settings` (ai-rust wave). Every command returns [`crate::CommandResult`].

pub mod ai;
pub mod fonts;
pub mod io;
pub mod oauth;
pub mod presets;
pub mod settings;
