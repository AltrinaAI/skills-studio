# Skill Studio — Architecture & Design Principles

> Read before adding a feature. **One rule: every capability is reached over HTTP. There is no second transport.**

## One transport: HTTP only

Two parts that can run on **different machines** (the VS Code-remote model):

- **Backend (Rust, `server/`).** All real work — fs, git, skill discovery, secrets,
  terminals, on-device LLM — lives in `server/skill-core` (transport-agnostic, **no Tauri
  deps**); `skill-term` handles tmux terminals; `skill-server` exposes everything over
  `/api/*` (+ **SSE** for streaming) and serves the built UI.
- **Frontend (React/TS, `client/web/`).** Reaches the backend only through
  `client/web/lib/api.ts` — `http()` + `EventSource`, **never Tauri `invoke`, no `isTauri`
  branch**. `client/desktop/` is the thin Tauri shell.

**Browser** loads the SPA from skill-server and calls `/api/*` same-origin. **Desktop** brings
up one local loopback `skill-server` and points the webview at `http://127.0.0.1:<port>`; for
the remote case that local server is a **switchboard** reverse-proxying `/api/*` to an
on-demand remote server (the tunnel's local end is also loopback). So **"local" is just
"remote where the host is localhost"** — identical code both ways, `/api/*` always same-origin
(the desktop CSP `default-src 'self'` covers it). Any *outbound* network beyond the server must
originate in **Rust**, never the webview. (We dropped the `invoke` fast path because dual
transports silently diverge — a feature wired only through `invoke` broke browser/remote.)

## Adding a feature

1. **Logic** → a fn in `skill-core` (Tauri-free).
2. **HTTP route** → a match arm in `skill-server`'s `handle()` at `/api/<name>`. **This is the
   API** — if you can't reach it from skill-server, it isn't done.
3. **Frontend** → one fn in `client/web/lib/api.ts` calling `http(...)`.

- **Streaming** = SSE (`request.into_writer()` + chunked `data:`, see `stream_terminal`),
  consumed via `EventSource`. Rides a plain socket and an SSH tunnel alike — no duplex channel.
- **No native-only capabilities.** A native OS dialog only sees the *client* machine, breaking
  the remote model. Browse the (possibly remote) fs via `/api/list-dir` + the in-app
  `FolderPicker`; import via `/api/import-zip`; export via `/api/download`.

*Reference (keyless commit messages):* `commitmsg.rs` (diff prep, cache) → `commit_agent.rs`
shells out to a logged-in coding-agent CLI (Claude Code → Codex → Gemini, keyless via
subscription OAuth; opencode last, BYO-key); `engine.rs` (llama.cpp) is opt-in offline
(`SKILL_STUDIO_COMMIT_AGENT=llama`). Routes `POST /api/generate-commit-message`,
`GET /api/commit-model-status` → `api.generateCommitMessage()` / `api.commitModelStatus()`.

## UI layout (frontend IA)

Hash router (`createHashRouter`, Tauri webview) with one persistent shell + lazy pages.
**The shell never unmounts; each page mounts its own `NavBar`** (the shell does not).

- **Shell** (`app/AppShell.tsx`) globally mounts only: the `<Outlet>` (hidden via
  `display:none` on `/terminals`, not unmounted), an always-mounted `TerminalsHost` (live ptys
  survive nav), and `UpdateBanner`. No `StrictMode` (would double-attach pty/xterm). Only guard:
  `useDiscardBlocker`, fires *only* after an autosave failure — no auth gate.
- **Routes:** `/` Home · `/secrets` · `/mining` · `/terminals` (element `null`; UI is
  `TerminalsHost`) · `/studio/:root` (children: index = SKILL.md form, `file/*` = file pane,
  `commit/:sha` = worktree diff only) · `/markdown/:path` (standalone editor) · `*` → `/`.
- **Studio** = full-height column: `TopBar` (**no Save button — autosave is wordless**; a
  *version* is a git commit) → `PreviewBanner` (past-version only) → **Sidebar | center Outlet |
  optional `AgentPanel`** (resizable Terminals). Sidebar = one `SplitStack`: `FileTree` +
  `SourceControl` accordion (**New Changes** = working-tree + Save-version, also ⌘/Ctrl+S ·
  **Versions** = history, click checks a version into the worktree · **Remote/GitHub**,
  collapsed). Center = `SkillDocument`/`FilePane`/diff. Layout prefs are **global**
  (`studioLayout.ts`), not per-skill. (The "Versions panel" below = `SourceControl.tsx`.)
- **Design system** (`globals.css`): Tailwind v4, **no config** — CSS vars + `@theme inline`,
  class-based dark (`.dark`, set pre-paint). **Two-axis palette: `--brand` (navy) = identity
  only; `--accent` (teal) = all interaction.** Primitives: one `Modal`,
  `btn{Primary,Ghost,Danger}` (one filled primary per row), `Badge` via `color-mix`,
  `useConfirm` (`window.confirm` is a no-op in the `wry` webview). **Never render "altrina" in
  UI**; app name is Title Case "Skill Studio".

## Skill versioning: tracked by default

Each personal skill is its **own git repo** (versioned/diffed/rolled-back/synced
independently). **Auto-tracked:** `GET /api/discover` → `discover_and_autotrack` →
`gitops::auto_track_personal`, which off-thread `git init`s + lands a baseline **"Initial
version"** commit (an unborn HEAD reads all-dirty and can't sync; with no git identity we stop
at the empty repo and prompt on first manual save).

- **Eligible = personal, not a `generated-skills/` proposal, not inside a parent repo** (never
  nest `.git` in someone's project); already-`.git` roots are skipped. `ensure_exclude` seeds a
  local `.git/info/exclude` (never a committed `.gitignore`) before `git add -A`.
- **Opt-out is sticky:** `git-untrack` deletes the skill's `.git` and denylists its path
  (`~/.config/skill-studio/untracked.json`) so discovery won't re-create it; `git-track` clears
  it + re-baselines. Untrack refuses when a parent repo owns history.
- Routes: `git-track`/`git-untrack`, `git-commit` (Save-version) + `git-log`/`git-status`/
  `git-info`; surfaced in `SourceControl.tsx`.

## Dev workflows

| Goal | Backend | Frontend | Open |
|------|---------|----------|------|
| Browser, local backend | `cargo run -p skill-server` (`:8765`) | `npm run dev:vite` (`:1420`) | **`localhost:1420`** — Vite proxies `/api` → 8765 |
| Browser/desktop, **remote** backend | skill-server on the remote host | `VITE_API_TARGET=http://<remote>:8765 npm run dev:vite` | `localhost:1420` |
| Native desktop | the shell spawns a loopback `skill-server` | `npm run tauri dev` | the native window |
| Production / remote | `npm run build` then run skill-server | (served by skill-server) | skill-server's port (UI + API, one origin) |

The Vite `/api` proxy (`vite.config.ts`, target via `VITE_API_TARGET`) defaults to `:8765`;
`tauri dev` spawns its own loopback server there. Desktop runs the server in-process via
`skill_server::spawn(ServerConfig)` (`client/desktop/src/lib.rs`); `ServerConfig` carries the
bearer `token` + `examples_base`.

## Terminals: persistent by design

Agent terminals are tmux sessions (`ass-*`); the backend is only a **bridge** (`tmux attach`
in a PTY).

1. **A terminal outlives everything but an explicit kill** — closing a tab, quitting the app,
   dropping SSH, or restarting/upgrading a backend never stops the agent inside.
2. **The `ass-*` namespace is machine-wide, unfiltered:** every backend lists/attaches/kills all
   studio sessions, so any client picks up any agent. The pid in `ass-<pid>-<secs>-<seq>` only
   prevents name collisions; `@ass_owner_pid` is provenance, not a lifecycle key.
3. **Only auto-reaping = a high-bar GC** (`sweep_stale`, at startup): collected only when
   unattached **and** every pane is back at a plain shell **and** idle ≥1 week.

Multiple backends per machine are supported (shared namespace); the inference-engine reaper
kills only *orphaned* engines (reparented to init) — never a sibling's live child **on Unix**
(the Windows fallback kills by image name and can hit a sibling, accepted for that rare case).

## Agent registry (`skill-core/src/agents.rs`)

Agent-agnostic: nothing outside the registry matches a family name. One `AgentDef` per CLI:

- **skills_dirs / reads_shared** — where it discovers skills (own folders + the shared
  `~/.agents/skills`).
- **launch** — the *interactive TUI* with the prompt pre-submitted (claude/codex/cursor:
  positional; gemini: `-i`; opencode: `--prompt`). An app-driven run is an ordinary session
  (same approvals/lifetime; the previewed prompt is the *whole* prompt); the caller brings the
  user to its terminal. (Headless modes dropped — claude `-p` ends the run at turn end.)
- **resume** — reopen the run dir's latest conversation (claude/opencode: `--continue`; codex:
  `resume --last`; gemini: `--resume` — all cwd-scoped, so each run gets a stable dir).

Features consume capabilities, not names (mining = `launch` + navigate; "continue" = `resume`;
`canMine` = `can_launch`); the UI degrades when a capability is `None` (no TUI launch → not
offered for mining; no cwd-scoped resume, e.g. Cursor → can't revive). **New agent = one
entry**; leave a capability `None` if undocumented.

## Connection manager (VS Code "Remote - SSH")

A **local proxy switchboard**; the webview never changes origin.

- `/api/remote/{list,connect,disconnect,status,last}` is **always local** (`SshRemoteControl`,
  `server/skill-server/src/sshmgr/`); shells out to `ssh`, or `wsl.exe` for `wsl:<distro>`
  targets. A `Transport` enum abstracts the two (a WSL distro is just Linux).
- While connected, **every other `/api/*` (incl. the `/api/terminal/attach` SSE) is
  reverse-proxied** to the remote (`proxy.rs`) with the bearer token injected upstream — **so
  the token never reaches the browser**. Also pinned local: `/api/update/*` and
  `/api/client-log`. Non-`/api` GETs serve the local UI.
- **Connect flow:** list targets (`~/.ssh/config` + WSL distros) → detect arch (`uname`) →
  ensure a version-pinned static-musl `skill-server` (checksum-verified) → launch loopback-bound
  with a token via env → one transport child is both tunnel and lifeline (held stdin EOFs the
  remote on disconnect/crash). ssh uses `ssh -L`; WSL shares Windows loopback (no `-L`). On
  "connected" the SPA reloads; tmux terminals survive reconnects.
- **Resume/recents:** the last host is remembered on the connecting machine (`/api/remote/last`,
  `sshmgr/lastconn.rs`) and auto-reconnected; `disconnect(forget=true)` clears it. Recents
  (`/api/recents`) are a *normal proxied* route, so they follow the active server.
- **Same code everywhere;** two gates keep it from brokering where it shouldn't: a provisioned
  remote (`--lifeline-stdin`) and a non-loopback bind both leave `ServerConfig::remote = None`.
  Provisioning pulls `skill-server-<target>` from the GitHub release matching the app version
  (override via `SKILL_STUDIO_SERVER_BASE_URL` / `_VERSION`).

## Roadmap

- **Kill Rust↔TS wire drift:** generate `api.ts` DTOs from serde structs (`ts-rs`) + a CI check.
- **Skill-usage feedback loop (mining):** the miner already extracts `skills_used` + distills
  user feedback; recurrent runs can report "skill triggered N times / never since accepted" and
  feed shortfalls back as improvements (undertriggering is the compounding risk).
