// Filesystem layer, ported from the original lib/server.ts. Transport-agnostic
// (no Tauri) — reused by the desktop commands and the headless server.
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;
use zip::write::SimpleFileOptions;

use crate::filetypes;
use crate::pathsafe::{normalize_lexical, resolve_root, resolve_within_real};

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024; // 2 MB
const MAX_TREE_ENTRIES: i64 = 5000;
const MAX_TOTAL: u64 = 100 * 1024 * 1024; // 100 MB zip cap
const IGNORED_DIRS: [&str; 5] = [".git", "node_modules", ".next", "__pycache__", ".venv"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    name: String,
    rel: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_skill_md: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<TreeNode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSkill {
    root: String,
    dir_name: String,
    raw: String,
    tree: Vec<TreeNode>,
    files: Vec<String>,
    file_count: usize,
    dir_count: usize,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileView {
    rel: String,
    category: String,
    language: String,
    label: String,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    too_large: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_binary: Option<bool>,
}

#[derive(Serialize)]
pub struct ImageData {
    pub mime: String,
    pub base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    is_dir: bool,
    is_skill: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    path: String,
    parent: Option<String>,
    entries: Vec<DirEntry>,
}

fn to_posix(abs: &Path, root: &Path) -> String {
    let rel = abs.strip_prefix(root).unwrap_or(abs);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

struct BuildAcc {
    files: Vec<String>,
    file_count: usize,
    dir_count: usize,
    total_bytes: u64,
    budget: i64,
}

fn walk_tree(dir: &Path, root: &Path, acc: &mut BuildAcc) -> Vec<TreeNode> {
    let mut entries: Vec<_> = match std::fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return vec![],
    };
    entries.sort_by(|a, b| {
        let a_is_file = a.file_type().map(|t| !t.is_dir()).unwrap_or(true);
        let b_is_file = b.file_type().map(|t| !t.is_dir()).unwrap_or(true);
        a_is_file
            .cmp(&b_is_file)
            .then_with(|| a.file_name().cmp(&b.file_name()))
    });

    let mut nodes = Vec::new();
    for entry in entries {
        if acc.budget <= 0 {
            break;
        }
        acc.budget -= 1;

        let name = entry.file_name().to_string_lossy().into_owned();
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let abs = dir.join(&name);
        let rel = to_posix(&abs, root);

        if ft.is_dir() {
            if IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }
            acc.dir_count += 1;
            let children = walk_tree(&abs, root, acc);
            nodes.push(TreeNode {
                name,
                rel,
                kind: "dir".into(),
                size: None,
                category: None,
                language: None,
                label: None,
                is_skill_md: None,
                children: Some(children),
            });
        } else if ft.is_file() {
            acc.file_count += 1;
            let size = std::fs::metadata(&abs).map(|m| m.len()).unwrap_or(0);
            acc.total_bytes += size;
            acc.files.push(rel.clone());
            let (category, language, label) = filetypes::file_type(&name);
            let is_skill_md = rel == "SKILL.md";
            nodes.push(TreeNode {
                name,
                rel,
                kind: "file".into(),
                size: Some(size),
                category: Some(category.into()),
                language: Some(language.into()),
                label: Some(label.into()),
                is_skill_md: Some(is_skill_md),
                children: None,
            });
        }
    }
    nodes
}

/// Resolve a skill path: `~`/absolute via resolve_root; a relative path (bundled
/// examples) against `examples_base`, then the working dir.
pub fn resolve_skill_input(input: &str, examples_base: Option<&Path>) -> PathBuf {
    let trimmed = input.trim();
    if trimmed == "~" || trimmed.starts_with("~/") || Path::new(trimmed).is_absolute() {
        return resolve_root(trimmed);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(base) = examples_base {
        candidates.push(base.join(trimmed));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(trimmed));
    }
    for c in &candidates {
        if c.exists() {
            return normalize_lexical(c);
        }
    }
    normalize_lexical(&candidates.into_iter().next().unwrap_or_else(|| PathBuf::from(trimmed)))
}

/// Read + analyze a skill directory.
pub fn build_raw_skill(root: &Path) -> Result<RawSkill, String> {
    let meta = std::fs::metadata(root).map_err(|_| format!("Path not found: {}", root.display()))?;
    if !meta.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }
    let skill_md = root.join("SKILL.md");
    if !skill_md.exists() {
        return Err(format!(
            "No SKILL.md found in {}. A skill directory must contain a SKILL.md file.",
            root.display()
        ));
    }
    let raw = std::fs::read_to_string(&skill_md).map_err(|e| format!("Failed to read SKILL.md: {e}"))?;

    let mut acc = BuildAcc {
        files: Vec::new(),
        file_count: 0,
        dir_count: 0,
        total_bytes: 0,
        budget: MAX_TREE_ENTRIES,
    };
    let tree = walk_tree(root, root, &mut acc);
    let dir_name = root
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(RawSkill {
        root: root.to_string_lossy().into_owned(),
        dir_name,
        raw,
        tree,
        files: acc.files,
        file_count: acc.file_count,
        dir_count: acc.dir_count,
        total_bytes: acc.total_bytes,
    })
}

pub fn read_file_impl(root: &str, rel: &str) -> Result<FileView, String> {
    let root_path = PathBuf::from(root);
    let abs = resolve_within_real(&root_path, rel, true)?;
    let meta = std::fs::metadata(&abs).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("Not a file: {rel}"));
    }
    let name = abs
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (category, language, label) = filetypes::file_type(&name);
    let size = meta.len();

    let mut view = FileView {
        rel: rel.to_string(),
        category: category.into(),
        language: language.into(),
        label: label.into(),
        size,
        content: None,
        too_large: None,
        is_binary: None,
    };

    if filetypes::is_image(&name) {
        return Ok(view);
    }
    if size > MAX_TEXT_BYTES {
        view.too_large = Some(true);
        return Ok(view);
    }
    let bytes = std::fs::read(&abs).map_err(|e| e.to_string())?;
    if !filetypes::is_textual(&name) && bytes.contains(&0u8) {
        view.is_binary = Some(true);
        view.category = "binary".into();
        return Ok(view);
    }
    view.content = Some(String::from_utf8_lossy(&bytes).into_owned());
    Ok(view)
}

pub fn write_file_impl(root: &str, rel: &str, content: &str) -> Result<(), String> {
    let root_path = PathBuf::from(root);
    let abs = resolve_within_real(&root_path, rel, false)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs, content).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn read_image_impl(root: &str, rel: &str) -> Result<ImageData, String> {
    let root_path = PathBuf::from(root);
    let abs = resolve_within_real(&root_path, rel, true)?;
    let meta = std::fs::metadata(&abs).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("File not found: {rel}"));
    }
    let bytes = std::fs::read(&abs).map_err(|e| e.to_string())?;
    let name = abs
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(ImageData {
        mime: filetypes::image_mime(&name).into(),
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

/// List subdirectories of `path` (for a remote folder picker). Shows hidden dirs
/// (skills live under e.g. ~/.codex) and flags which dirs are skills.
pub fn list_dir_impl(path: &str) -> Result<DirListing, String> {
    let p = if path.trim().is_empty() {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
    } else {
        resolve_root(path)
    };
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return Err(format!("Not a directory: {}", p.display()));
    }
    let mut entries = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&p) {
        for e in rd.filter_map(|e| e.ok()) {
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir {
                continue;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            let is_skill = p.join(&name).join("SKILL.md").exists();
            entries.push(DirEntry {
                name,
                is_dir: true,
                is_skill,
            });
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(DirListing {
        path: p.to_string_lossy().into_owned(),
        parent: p.parent().map(|pp| pp.to_string_lossy().into_owned()),
        entries,
    })
}

/// Resolve + validate a skill root and return (filename, zip bytes).
pub fn zip_skill_bytes(root_input: &str) -> Result<(String, Vec<u8>), String> {
    let root = resolve_root(root_input);
    let meta = std::fs::metadata(&root).map_err(|_| format!("Skill not found: {}", root.display()))?;
    if !meta.is_dir() {
        return Err(format!("Skill not found: {}", root.display()));
    }
    if !root.join("SKILL.md").exists() {
        return Err("Not a skill directory (no SKILL.md).".into());
    }
    let dir_name = root
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "skill".into());
    let buf = build_zip(&root, &dir_name)?;
    Ok((format!("{dir_name}.zip"), buf))
}

fn build_zip(root: &Path, dir_name: &str) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::<u8>::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut total: u64 = 0;
    walk_zip(root, "", dir_name, &mut zip, &options, &mut total)?;
    let cursor = zip.finish().map_err(|e| e.to_string())?;
    Ok(cursor.into_inner())
}

fn walk_zip(
    dir: &Path,
    prefix: &str,
    dir_name: &str,
    zip: &mut zip::ZipWriter<Cursor<Vec<u8>>>,
    options: &SimpleFileOptions,
    total: &mut u64,
) -> Result<(), String> {
    let rd = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in rd.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let abs = entry.path();
        if ft.is_dir() {
            if IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk_zip(&abs, &format!("{prefix}{name}/"), dir_name, zip, options, total)?;
        } else if ft.is_file() {
            let data = match std::fs::read(&abs) {
                Ok(d) => d,
                Err(_) => continue,
            };
            *total += data.len() as u64;
            if *total > MAX_TOTAL {
                return Err("Skill is too large to download.".into());
            }
            zip.start_file(format!("{dir_name}/{prefix}{name}"), *options)
                .map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
