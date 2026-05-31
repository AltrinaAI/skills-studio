"use client";

import { useEffect, useState } from "react";
import { Spinner, ThemeToggle } from "./ui";
import { BrandIcon } from "./FileIcon";
import FolderPicker from "./FolderPicker";
import { useRecents, removeRecent } from "./recents";
import * as api from "@/lib/api";
import type { AgentSkills } from "@/lib/api";

const EXAMPLES = [
  { name: "docx", path: "examples/docx", blurb: "Create & edit Word documents" },
  { name: "pdf", path: "examples/pdf", blurb: "Extract, fill & process PDFs" },
  { name: "pptx", path: "examples/pptx", blurb: "Build PowerPoint decks" },
  { name: "xlsx", path: "examples/xlsx", blurb: "Read & write spreadsheets" },
];

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export default function Home({
  onOpen,
  loading,
  error,
  toggleTheme,
}: {
  onOpen: (path: string) => void;
  loading: boolean;
  error: string | null;
  toggleTheme: () => void;
}) {
  const recents = useRecents();
  const [path, setPath] = useState("");

  const [discovered, setDiscovered] = useState<AgentSkills[]>([]);
  const [discovering, setDiscovering] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api
      .discoverSkills()
      .then((d) => !cancelled && (setDiscovered(d), setDiscovering(false)))
      .catch(() => !cancelled && setDiscovering(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const [showPicker, setShowPicker] = useState(false);
  const browse = async () => {
    if (api.isTauri) {
      const p = await api.pickSkillFolder();
      if (p) onOpen(p);
    } else {
      setShowPicker(true);
    }
  };

  const groups = discovered.filter((g) => g.skills.length > 0);
  const totalFound = groups.reduce((n, g) => n + g.skills.length, 0);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center px-6 py-4">
        <div className="flex items-center gap-2 font-medium text-fg">
          <BrandIcon />
          <span>Agent Skill Studio</span>
        </div>
        <div className="ml-auto">
          <ThemeToggle onClick={toggleTheme} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 pt-10 pb-24">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Open a skill</h1>
        <p className="mt-1.5 text-sm text-muted">
          A skill is a folder containing a <code className="rounded bg-panel px-1 py-0.5 font-mono text-[0.8em]">SKILL.md</code>.
          Browse for one, paste a path, or pick from the skills found on your machine below.
        </p>

        <form
          className="mt-6 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (path.trim()) onOpen(path.trim());
          }}
        >
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/absolute/path/to/skill-folder"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={browse}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-fg hover:bg-panel"
          >
            Browse…
          </button>
          <button
            type="submit"
            disabled={loading || !path.trim()}
            aria-busy={loading}
            className="inline-flex min-w-20 items-center justify-center gap-2 rounded-lg bg-fg px-4 py-2 text-sm font-medium text-app disabled:opacity-40"
          >
            {loading ? <Spinner className="h-3.5 w-3.5" /> : "Open"}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <section className="mt-10">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Discovered
            {discovering ? <Spinner className="h-3 w-3" /> : <span className="text-faint">· {totalFound}</span>}
          </h2>
          {!discovering && totalFound === 0 ? (
            <p className="text-sm text-muted">
              No installed skills found. Skills live under <code className="font-mono text-[0.8em]">~/.claude/skills</code>,{" "}
              <code className="font-mono text-[0.8em]">~/.codex/skills</code>,{" "}
              <code className="font-mono text-[0.8em]">~/.cursor/skills-cursor</code>, and{" "}
              <code className="font-mono text-[0.8em]">~/.openclaw/skills</code>.
            </p>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => (
                <div key={group.agent}>
                  <h3 className="mb-1 text-xs font-medium text-fg">
                    {group.agent} <span className="text-faint">· {group.skills.length}</span>
                  </h3>
                  <ul className="-mx-2">
                    {group.skills.map((s) => (
                      <li key={s.root}>
                        <button
                          type="button"
                          onClick={() => onOpen(s.root)}
                          className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-panel"
                        >
                          <span className="flex items-baseline gap-2">
                            <span className="truncate text-sm font-medium text-fg">{s.name ?? baseName(s.root)}</span>
                            <span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-faint">{s.sourceLabel}</span>
                          </span>
                          {s.description && <span className="truncate text-xs text-muted">{s.description}</span>}
                          <span className="truncate text-[0.7rem] text-faint">{s.root}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {recents.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Recent</h2>
            <ul className="-mx-2">
              {recents.map((r) => (
                <li key={r.root} className="group flex items-center gap-2 rounded-lg px-2 hover:bg-panel">
                  <button
                    type="button"
                    onClick={() => onOpen(r.root)}
                    className="flex min-w-0 flex-1 flex-col py-2 text-left"
                  >
                    <span className="truncate text-sm font-medium text-fg">{r.name}</span>
                    <span className="truncate text-xs text-muted">{r.root}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRecent(r.root)}
                    aria-label={`Remove ${r.name} from recents`}
                    className="shrink-0 px-2 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Examples</h2>
          <ul className="-mx-2">
            {EXAMPLES.map((ex) => (
              <li key={ex.path}>
                <button
                  type="button"
                  onClick={() => onOpen(ex.path)}
                  className="flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left hover:bg-panel"
                >
                  <span className="font-mono text-sm font-medium text-fg">{ex.name}</span>
                  <span className="truncate text-xs text-muted">{ex.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {showPicker && (
        <FolderPicker
          onSelect={(p) => {
            setShowPicker(false);
            onOpen(p);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
