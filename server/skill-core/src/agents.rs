//! The agent interface. Every agent CLI Skill Studio integrates with is one
//! [`AgentDef`] entry declaring the shared properties an integration needs:
//!
//! - **skills_dirs** — where the agent discovers skills (its own folders, plus
//!   the shared standard when `reads_shared`),
//! - **launch** — how to start it on a task: the interactive TUI command line
//!   with the initial prompt pre-submitted. An app-driven run is an ordinary
//!   agent session — same harness semantics, same approval prompts, same
//!   lifetime as if the user had typed the prompt themselves — so the caller
//!   must bring the user to its terminal, where any first-run dialog is
//!   answered. (The previous headless pipelines were dropped deliberately:
//!   print modes diverge from a real session — claude's `-p` ends the run the
//!   moment the agent ends its turn and kills its background tasks.)
//! - **resume** — how to reopen the terminal cwd's most recent conversation
//!   as the interactive TUI after the original terminal is gone.
//!
//! Features (mining, install, terminals) consult this registry instead of
//! matching on family names, so supporting a new agent = filling in one entry.
//! A `None` capability means the agent can't do that yet and the UI degrades
//! accordingly (e.g. it isn't offered for mining runs).

use crate::secrets::sh_quote as q;

/// Home-relative dirs of the shared Agent Skills standard, read by every
/// `reads_shared` agent (Codex, Cursor, Gemini CLI, …; not Claude Code).
pub const SHARED_SKILLS_DIRS: &[&str] = &[".agents/skills", ".agent/skills"];

/// Context for building an interactive launch line: the agent's TUI in the
/// run's terminal (cwd = the run dir), with `prompt` submitted as the first
/// user message.
pub struct LaunchCtx<'a> {
    pub bin: &'a str,
    pub prompt: &'a str,
    /// Model / reasoning-effort overrides (None = the CLI's default).
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
}

/// Context for building a resume line: reopen the most recent conversation in
/// the terminal's cwd (the run dir) as the interactive TUI, same tuning.
pub struct ResumeCtx<'a> {
    pub bin: &'a str,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
}

pub struct AgentDef {
    /// Family id — the prefix of skill-term agent ids ("claude" in "claude:cli").
    pub family: &'static str,
    pub label: &'static str,
    /// The agent's OWN skill-discovery dirs, home-relative.
    pub skills_dirs: &'static [&'static str],
    /// Whether the agent also reads [`SHARED_SKILLS_DIRS`].
    pub reads_shared: bool,
    pub launch: Option<fn(&LaunchCtx) -> String>,
    pub resume: Option<fn(&ResumeCtx) -> String>,
}

pub const AGENTS: &[AgentDef] = &[
    AgentDef {
        family: "claude",
        label: "Claude Code",
        skills_dirs: &[".claude/skills"],
        reads_shared: false,
        launch: Some(claude_launch),
        resume: Some(claude_resume),
    },
    AgentDef {
        family: "codex",
        label: "Codex",
        skills_dirs: &[".codex/skills"],
        reads_shared: true,
        launch: Some(codex_launch),
        resume: Some(codex_resume),
    },
    AgentDef {
        family: "cursor",
        label: "Cursor",
        skills_dirs: &[".cursor/skills", ".cursor/skills-cursor"],
        reads_shared: true,
        launch: Some(cursor_launch),
        // `cursor-agent resume` targets the GLOBAL latest session, not the
        // cwd's — wiring it could reopen an unrelated conversation.
        resume: None,
    },
    AgentDef {
        family: "gemini",
        label: "Gemini CLI",
        skills_dirs: &[],
        reads_shared: true,
        launch: Some(gemini_launch),
        resume: Some(gemini_resume),
    },
    AgentDef {
        family: "openclaw",
        label: "OpenClaw",
        skills_dirs: &[".openclaw/skills"],
        reads_shared: false,
        launch: None,
        resume: None,
    },
];

/// Look up an agent by family, accepting full skill-term ids ("claude:cli").
pub fn by_family(family_or_id: &str) -> Option<&'static AgentDef> {
    let family = family_or_id.split(':').next().unwrap_or(family_or_id);
    AGENTS.iter().find(|a| a.family == family)
}

/// True when the family has an interactive launch line — the gate for
/// app-driven runs (skill mining): the run starts in a live terminal the
/// user is brought to, so its dialogs and prompts are answerable.
pub fn can_launch(family_or_id: &str) -> bool {
    by_family(family_or_id).map(|a| a.launch.is_some()).unwrap_or(false)
}

/// Every skill dir any known agent reads (shared standard + each agent's own),
/// home-relative — e.g. the writable roots a sandboxed run needs to reach.
pub fn all_skills_dirs() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = SHARED_SKILLS_DIRS.to_vec();
    for a in AGENTS {
        for d in a.skills_dirs {
            if !out.contains(d) {
                out.push(d);
            }
        }
    }
    out
}

/// Append ` --add-dir <dir>` for every skill home that exists on this machine
/// (claude and codex take the same flag): skill writes count as in-workspace
/// edits instead of out-of-tree approval round-trips.
fn push_skill_dirs(cmd: &mut String) {
    if let Some(home) = dirs::home_dir() {
        for rel in all_skills_dirs() {
            let dir = home.join(rel);
            if dir.exists() {
                cmd.push_str(&format!(" --add-dir {}", q(&dir.to_string_lossy())));
            }
        }
    }
}

// ─────────────────────────────── Claude Code ───────────────────────────────

/// The interactive TUI with the prompt as the positional argument (submitted
/// as the first user message — `claude` is interactive by default). The
/// prompt comes FIRST: `--add-dir <directories...>` is variadic and would
/// swallow a trailing positional. Permission mode `auto` keeps the run mostly
/// hands-off, the same option the terminal picker offers (model-gated:
/// Opus/Sonnet 4.6+, not haiku). The first launch in a fresh run dir shows
/// the one-time workspace-trust dialog; the accept persists per directory.
fn claude_launch(c: &LaunchCtx) -> String {
    let mut cmd = format!(
        "{} {} --permission-mode auto{}",
        q(c.bin),
        q(c.prompt),
        claude_tune(c.model, c.effort)
    );
    push_skill_dirs(&mut cmd);
    cmd
}

/// `--continue` reopens the most recent conversation in the current directory
/// (documented as cwd-scoped), so the stable run dir is the only key needed.
fn claude_resume(c: &ResumeCtx) -> String {
    format!("{} --continue{}", q(c.bin), claude_tune(c.model, c.effort))
}

fn claude_tune(model: Option<&str>, effort: Option<&str>) -> String {
    let mut tune = String::new();
    if let Some(m) = model {
        tune.push_str(&format!(" --model {}", q(m)));
    }
    if let Some(e) = effort {
        tune.push_str(&format!(" --effort {}", q(e)));
    }
    tune
}

// ────────────────────────────────── Codex ──────────────────────────────────

/// The TUI with the optional `[PROMPT]` positional (submitted, not prefilled;
/// first for symmetry with claude's line). Sandbox and approvals stay on
/// codex's interactive defaults — the user is watching the pane, so its
/// native prompts are answerable; the old `exec` overrides existed only
/// because nobody was. Effort rides the `-c` config override (the CLI has no
/// dedicated flag).
fn codex_launch(c: &LaunchCtx) -> String {
    let mut cmd = format!("{} {}", q(c.bin), q(c.prompt));
    if let Some(m) = c.model {
        cmd.push_str(&format!(" -m {}", q(m)));
    }
    if let Some(e) = c.effort {
        cmd.push_str(&format!(" -c {}", q(&format!("model_reasoning_effort=\"{e}\""))));
    }
    push_skill_dirs(&mut cmd);
    cmd
}

/// `resume --last` continues the most recent session scoped to the current
/// working directory. Codex documents no model/effort flags on `resume`, so
/// the tuning is the session's own.
fn codex_resume(c: &ResumeCtx) -> String {
    format!("{} resume --last", q(c.bin))
}

// ────────────────────────────── Cursor / Gemini ──────────────────────────────

/// The TUI with the prompt as the positional argument; `--model` is the only
/// documented tuning knob.
fn cursor_launch(c: &LaunchCtx) -> String {
    let mut cmd = format!("{} {}", q(c.bin), q(c.prompt));
    if let Some(m) = c.model {
        cmd.push_str(&format!(" --model {}", q(m)));
    }
    cmd
}

/// `-i/--prompt-interactive` is the documented "execute the prompt, then stay
/// interactive" path — a bare positional prompt would run headless instead.
fn gemini_launch(c: &LaunchCtx) -> String {
    let mut cmd = q(c.bin).to_string();
    if let Some(m) = c.model {
        cmd.push_str(&format!(" -m {}", q(m)));
    }
    cmd.push_str(&format!(" -i {}", q(c.prompt)));
    cmd
}

/// `--resume` (no value) loads the most recent session, project-scoped. The
/// model flag precedes it so the optional-valued `--resume` can't eat it.
fn gemini_resume(c: &ResumeCtx) -> String {
    let mut cmd = q(c.bin).to_string();
    if let Some(m) = c.model {
        cmd.push_str(&format!(" -m {}", q(m)));
    }
    cmd.push_str(" --resume");
    cmd
}

// ─────────────────────────────────── tests ───────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_lookup_accepts_ids_and_families() {
        assert_eq!(by_family("claude").unwrap().label, "Claude Code");
        assert_eq!(by_family("codex:cli").unwrap().label, "Codex");
        assert!(by_family("shell").is_none());
        assert!(can_launch("claude:cli") && can_launch("codex"));
        assert!(can_launch("cursor") && can_launch("gemini"));
        assert!(!can_launch("openclaw") && !can_launch("shell"));
    }

    #[test]
    fn all_skills_dirs_unions_shared_and_own() {
        let dirs = all_skills_dirs();
        for d in [".agents/skills", ".claude/skills", ".codex/skills", ".cursor/skills"] {
            assert!(dirs.contains(&d), "missing {d}");
        }
        let dedup: std::collections::HashSet<_> = dirs.iter().collect();
        assert_eq!(dedup.len(), dirs.len(), "no duplicates");
    }

    #[test]
    fn resume_lines_reopen_the_cwds_conversation() {
        let ctx = ResumeCtx { bin: "/bin/claude", model: Some("opus"), effort: None };
        assert_eq!(claude_resume(&ctx), "'/bin/claude' --continue --model 'opus'");

        let ctx = ResumeCtx { bin: "/bin/codex", model: None, effort: None };
        assert_eq!(codex_resume(&ctx), "'/bin/codex' resume --last");

        let ctx = ResumeCtx { bin: "/bin/gemini", model: Some("pro"), effort: None };
        // -m before --resume: --resume takes an optional value and would eat it.
        assert_eq!(gemini_resume(&ctx), "'/bin/gemini' -m 'pro' --resume");
    }
}
