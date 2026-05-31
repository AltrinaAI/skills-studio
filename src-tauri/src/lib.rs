// Tauri desktop app: thin #[tauri::command] wrappers over skill-core.
use skill_core::{discover, skill};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn read_skill(app: tauri::AppHandle, path: String) -> Result<skill::RawSkill, String> {
    let base = app.path().resource_dir().ok();
    let root = skill::resolve_skill_input(&path, base.as_deref());
    skill::build_raw_skill(&root)
}

#[tauri::command]
async fn read_file(root: String, rel: String) -> Result<skill::FileView, String> {
    skill::read_file_impl(&root, &rel)
}

#[tauri::command]
async fn write_file(root: String, rel: String, content: String) -> Result<(), String> {
    skill::write_file_impl(&root, &rel, &content)
}

#[tauri::command]
async fn read_image_base64(root: String, rel: String) -> Result<skill::ImageData, String> {
    skill::read_image_impl(&root, &rel)
}

#[tauri::command]
async fn discover_skills() -> Result<Vec<discover::AgentSkills>, String> {
    discover::discover_all()
}

#[tauri::command]
async fn pick_skill_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(app.dialog().file().blocking_pick_folder().map(|p| p.to_string()))
}

#[tauri::command]
async fn export_skill_zip(app: tauri::AppHandle, root: String) -> Result<bool, String> {
    let (filename, buf) = skill::zip_skill_bytes(&root)?;
    let chosen = app
        .dialog()
        .file()
        .set_file_name(filename)
        .add_filter("Zip archive", &["zip"])
        .blocking_save_file();
    let Some(dest) = chosen else {
        return Ok(false);
    };
    std::fs::write(std::path::PathBuf::from(dest.to_string()), buf).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_skill,
            read_file,
            write_file,
            read_image_base64,
            discover_skills,
            pick_skill_folder,
            export_skill_zip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
