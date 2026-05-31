// Transport-agnostic core: skill filesystem ops + discovery, no GUI/Tauri deps.
// Reused by both the Tauri desktop app and the headless skill-server.
pub mod discover;
pub mod filetypes;
pub mod pathsafe;
pub mod skill;
