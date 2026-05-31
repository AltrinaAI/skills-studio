// Skill auto-discovery across agents' global/home canonical locations.
// A skill = a directory containing SKILL.md (nested layouts supported).
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    name: Option<String>,
    description: Option<String>,
    root: String,
    source_label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkills {
    agent: String,
    skills: Vec<DiscoveredSkill>,
}

#[derive(serde::Deserialize, Default)]
struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
}

fn is_ignored_dir(p: &Path) -> bool {
    p.file_name()
        .and_then(|n| n.to_str())
        .map(|n| matches!(n, ".git" | "node_modules" | ".venv" | ".next" | "__pycache__"))
        .unwrap_or(false)
}

/// Extract the leading `---` ... `---` YAML block (BOM-tolerant).
fn extract_frontmatter(raw: &str) -> Option<String> {
    let s = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let mut lines = s.lines();
    match lines.next() {
        Some(first) if first.trim_end() == "---" => {}
        _ => return None,
    }
    let mut block = String::new();
    for line in lines {
        if line.trim_end() == "---" {
            return Some(block);
        }
        block.push_str(line);
        block.push('\n');
    }
    None
}

fn read_meta(skill_md: &Path) -> (Option<String>, Option<String>) {
    let Ok(raw) = std::fs::read_to_string(skill_md) else {
        return (None, None);
    };
    let Some(block) = extract_frontmatter(&raw) else {
        return (None, None);
    };
    match serde_yaml::from_str::<Frontmatter>(&block) {
        Ok(f) => (f.name, f.description),
        Err(_) => (None, None),
    }
}

fn collect(root: &Path, label: &str, skills: &mut Vec<DiscoveredSkill>, seen: &mut HashSet<PathBuf>) {
    if !root.exists() {
        return;
    }
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !is_ignored_dir(e.path()))
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() || entry.file_name() != "SKILL.md" {
            continue;
        }
        let Some(skill_dir) = entry.path().parent().map(|p| p.to_path_buf()) else {
            continue;
        };
        let canon = std::fs::canonicalize(&skill_dir).unwrap_or_else(|_| skill_dir.clone());
        if !seen.insert(canon) {
            continue; // already found via another root
        }
        let (name, description) = read_meta(entry.path());
        skills.push(DiscoveredSkill {
            name,
            description,
            root: skill_dir.to_string_lossy().into_owned(),
            source_label: label.to_string(),
        });
    }
}

/// Discover skills across the per-agent global/home canonical dirs.
pub fn discover_all() -> Result<Vec<AgentSkills>, String> {
    let home = dirs::home_dir().ok_or_else(|| "No home directory.".to_string())?;

    let groups: Vec<(&str, Vec<(&str, PathBuf)>)> = vec![
        (
            "Claude Code",
            vec![
                ("personal", home.join(".claude/skills")),
                ("plugins", home.join(".claude/plugins")),
                ("plugins", home.join(".claude/remote/plugins")),
            ],
        ),
        ("Codex", vec![("skills", home.join(".codex/skills"))]),
        ("Cursor", vec![("skills", home.join(".cursor/skills-cursor"))]),
        (
            "OpenClaw",
            vec![
                ("openclaw", home.join(".openclaw/skills")),
                ("agents", home.join(".agents/skills")),
            ],
        ),
    ];

    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut out = Vec::new();
    for (agent, roots) in groups {
        let mut skills = Vec::new();
        for (label, root) in roots {
            collect(&root, label, &mut skills, &mut seen);
        }
        out.push(AgentSkills {
            agent: agent.to_string(),
            skills,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter() {
        let raw = "---\nname: my-skill\ndescription: Does things\n---\n\n# Body\n";
        let block = extract_frontmatter(raw).expect("frontmatter present");
        let fm: Frontmatter = serde_yaml::from_str(&block).unwrap();
        assert_eq!(fm.name.as_deref(), Some("my-skill"));
        assert_eq!(fm.description.as_deref(), Some("Does things"));
    }

    #[test]
    fn no_frontmatter_returns_none() {
        assert!(extract_frontmatter("# Just a heading\n").is_none());
        assert!(extract_frontmatter("").is_none());
    }

    #[test]
    fn bom_tolerant() {
        let raw = "\u{feff}---\nname: x\n---\n";
        assert_eq!(extract_frontmatter(raw).as_deref(), Some("name: x\n"));
    }

    #[test]
    fn discovers_a_planted_skill() {
        let base = std::env::temp_dir().join(format!("ass_discover_{}", std::process::id()));
        let skill = base.join("nested").join("my-skill");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "---\nname: my-skill\ndescription: hi\n---\nbody").unwrap();

        let mut found = Vec::new();
        let mut seen = HashSet::new();
        collect(&base, "test", &mut found, &mut seen);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name.as_deref(), Some("my-skill"));
        assert_eq!(found[0].source_label, "test");
        let _ = std::fs::remove_dir_all(&base);
    }

    // Real discovery against this machine; run with:
    // cargo test -p skill-core -- --nocapture live_discovery_smoke
    #[test]
    fn live_discovery_smoke() {
        let groups = discover_all().expect("discovery should not error");
        assert_eq!(groups.len(), 4, "one group per agent");
        let total: usize = groups.iter().map(|g| g.skills.len()).sum();
        println!("\n=== live discovery: {total} skill(s) across {} agents ===", groups.len());
        for g in &groups {
            println!("  {} ({})", g.agent, g.skills.len());
            for s in &g.skills {
                println!(
                    "    - {}  [{}]  {}",
                    s.name.as_deref().unwrap_or("(no name)"),
                    s.source_label,
                    s.root
                );
            }
        }
    }
}
