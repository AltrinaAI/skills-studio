# Skill Studio — agent guide

Skill Studio is a **Tauri 2 desktop app** for viewing, editing, versioning, and
running [Agent Skills](https://agentskills.io/home). The stack:

- **Rust backend.** All real work (filesystem, git, skill discovery, secrets,
  terminals, the on-device LLM) lives in `crates/skill-core` — pure, transport-agnostic
  Rust that `crates/skill-server` exposes over HTTP at `/api/*`. `crates/skill-term`
  handles tmux-backed terminals. `src-tauri/` is a thin native shell that spawns a
  `skill-server` and points a webview at it.
- **Frontend.** React 19 + TypeScript in `src/`, built with **Vite**. UI uses
  CodeMirror (`@uiw/react-codemirror`), `react-router-dom` v7, and xterm, and talks to
  the backend through `src/lib/api.ts`.

## The one rule that matters most

**Every capability is reached over HTTP/JSON (+ SSE for streaming):** `skill-server` is
the whole API, and that single transport is what lets the backend and frontend run on
different machines (the VS Code-remote model). Adding a feature = logic in `skill-core`
→ an `/api/<name>` route in `skill-server` → one function in `src/lib/api.ts`.

**Read [design.md](design.md) before adding a feature** — it is the authoritative
architecture doc (the HTTP-only rationale, the feature recipe, the dev-workflow table,
and the on-device commit-message reference example).

## Commands

- `npm run dev` — native desktop (`tauri dev`); a `skill-server` must be reachable at the Vite proxy target.
- `npm run dev:vite` — frontend only in the browser (`:1420`); pair with `cargo run -p skill-server` (`:8765`).
- `npm run build` — `tsc --noEmit && vite build`.
- `npm run lint` — ESLint.

Heed deprecation notices and follow the existing patterns in the relevant crate/module.
