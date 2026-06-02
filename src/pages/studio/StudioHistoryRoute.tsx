"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui";
import { skillKind } from "@/lib/agents";
import * as api from "@/lib/api";
import type { GitInfo, GitCommit, GitFileChange, GitCommitDetail } from "@/lib/api";
import DiffView from "./DiffView";
import { useStudio } from "./StudioContext";

type Sel = { kind: "worktree" } | { kind: "commit"; sha: string };

interface View {
  loading: boolean;
  error: string | null;
  diff: string;
  truncated: boolean;
  /** Present when a commit (not the working tree) is selected. */
  commit: GitCommitDetail | null;
}
const EMPTY_VIEW: View = { loading: false, error: null, diff: "", truncated: false, commit: null };

const KIND_LABEL: Record<string, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  untracked: "new",
  typechange: "type changed",
  unmerged: "conflicted",
};

/** A centered notice used by the not-tracked / not-yours / no-git states. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center text-sm text-muted">{children}</div>
    </div>
  );
}

export function Component() {
  const { data } = useStudio();
  const root = data.root;
  const kind = skillKind(root).kind;

  const [info, setInfo] = useState<GitInfo | null>(null);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [changes, setChanges] = useState<GitFileChange[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [view, setView] = useState<View>(EMPTY_VIEW);

  const [loaded, setLoaded] = useState(false);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [initErr, setInitErr] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitErr, setCommitErr] = useState<string | null>(null);

  // Load repo state (info + history + working-tree status). Picks a sensible
  // default selection: pending changes if any, else the latest commit. A failed
  // gitInfo surfaces as an error rather than an indefinite spinner.
  const refresh = useCallback(
    async (keepSel = false) => {
      setInfoErr(null);
      try {
        const i = await api.gitInfo(root);
        setInfo(i);
        if (!i.isRepo) {
          setLog([]);
          setChanges([]);
          return;
        }
        const [l, c] = await Promise.all([
          api.gitLog(root, 100).catch(() => [] as GitCommit[]),
          api.gitStatus(root).catch(() => [] as GitFileChange[]),
        ]);
        setLog(l);
        setChanges(c);
        if (!keepSel) {
          setSel(c.length > 0 ? { kind: "worktree" } : l[0] ? { kind: "commit", sha: l[0].sha } : null);
        }
      } catch (e) {
        setInfoErr(e instanceof Error ? e.message : "Failed to load git status");
      } finally {
        setLoaded(true);
      }
    },
    [root],
  );

  useEffect(() => {
    setLoaded(false);
    setSel(null);
    setView(EMPTY_VIEW);
    void refresh();
  }, [refresh]);

  // Load the diff for the current selection; a request guard drops a stale load
  // that resolves after the selection changed.
  const reqRef = useRef(0);
  useEffect(() => {
    if (!sel) return;
    const myReq = ++reqRef.current;
    setView((v) => ({ ...v, loading: true, error: null }));
    (async () => {
      try {
        if (sel.kind === "worktree") {
          const wt = await api.gitWorktreeDiff(root);
          if (myReq !== reqRef.current) return;
          setView({ loading: false, error: null, diff: wt.diff, truncated: wt.truncated, commit: null });
        } else {
          const d = await api.gitCommitDiff(root, sel.sha);
          if (myReq !== reqRef.current) return;
          setView({ loading: false, error: null, diff: d.diff, truncated: d.truncated, commit: d });
        }
      } catch (e) {
        if (myReq !== reqRef.current) return;
        setView({ ...EMPTY_VIEW, error: e instanceof Error ? e.message : "Failed to load diff" });
      }
    })();
  }, [sel, root]);

  const startTracking = async () => {
    setInitBusy(true);
    setInitErr(null);
    try {
      await api.gitInit(root);
      await refresh();
    } catch (e) {
      setInitErr(e instanceof Error ? e.message : "Failed to start tracking");
    } finally {
      setInitBusy(false);
    }
  };

  const doCommit = async () => {
    setCommitting(true);
    setCommitErr(null);
    try {
      const res = await api.gitCommit(root, message);
      setCommitOpen(false);
      setMessage("");
      await refresh(true);
      setSel({ kind: "commit", sha: res.sha });
    } catch (e) {
      setCommitErr(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  // ---- guard states -------------------------------------------------------
  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner /> <span className="ml-2">Loading history…</span>
      </div>
    );
  }
  if (infoErr || !info) {
    return <Notice>{infoErr ?? "Couldn’t load version history."}</Notice>;
  }
  if (!info.available) {
    return <Notice>Git isn’t installed — install git to enable version history for your skills.</Notice>;
  }
  // Mirror ManagePanel's guard order: the "not your skill" message is the most
  // actionable (it points to Sync), so it wins over the parent-repo note.
  if (kind !== "personal") {
    return (
      <Notice>
        Version history is for your own skills. Use <span className="font-medium text-fg">Manage → Sync</span> to make an
        editable copy you can version.
      </Notice>
    );
  }
  if (info.inParentRepo) {
    return (
      <Notice>
        This skill is tracked by a parent repository
        {info.toplevel ? (
          <>
            {" "}
            (<span className="font-mono text-[0.8em] text-faint">{info.toplevel}</span>)
          </>
        ) : null}
        . Manage its history there.
      </Notice>
    );
  }
  if (!info.isRepo) {
    return (
      <Notice>
        <p className="mb-3">This skill isn’t version-tracked yet.</p>
        <button
          type="button"
          onClick={startTracking}
          disabled={initBusy}
          className="rounded-md bg-fg px-3 py-1.5 text-sm font-medium text-app transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {initBusy ? "Starting…" : "Start tracking"}
        </button>
        {initErr && <p className="mt-3 text-xs text-danger">{initErr}</p>}
      </Notice>
    );
  }

  const dirtyCount = changes.length;
  const selectedCommit = sel?.kind === "commit" ? log.find((c) => c.sha === sel.sha) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header strip */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <span className="font-semibold text-fg">History</span>
        {info.branch && (
          <span className="flex items-center gap-1 font-mono text-xs text-faint">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="6" cy="6" r="2.5" />
              <circle cx="6" cy="18" r="2.5" />
              <circle cx="18" cy="9" r="2.5" />
              <path d="M6 8.5v7M8.4 6.6c5 .3 7.5 1 7.5 4.4M18 11.5c0 3-2.5 4-6 4.2" />
            </svg>
            {info.branch}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${info.dirty ? "bg-warn" : "bg-ok"}`} aria-hidden />
          <span className="text-muted">{info.dirty ? "Uncommitted changes" : "Up to date"}</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left rail: working-tree entry + commit list */}
        <aside className="flex w-64 shrink-0 flex-col overflow-auto border-r border-border bg-panel">
          <div className="px-3 pb-1 pt-3 text-[0.68rem] font-semibold uppercase tracking-wider text-muted">Changes</div>
          <button
            type="button"
            onClick={() => dirtyCount > 0 && setSel({ kind: "worktree" })}
            disabled={dirtyCount === 0}
            className={`mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
              sel?.kind === "worktree" ? "bg-accent-soft text-fg" : "text-fg hover:bg-surface"
            } disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dirtyCount > 0 ? "bg-warn" : "bg-ok"}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[0.82rem] font-medium">Working tree</span>
              <span className="block text-[0.7rem] text-muted">
                {dirtyCount > 0 ? `${dirtyCount} uncommitted change${dirtyCount === 1 ? "" : "s"}` : "No uncommitted changes"}
              </span>
            </span>
          </button>

          <div className="px-3 pb-1 pt-3 text-[0.68rem] font-semibold uppercase tracking-wider text-muted">History</div>
          {log.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No commits yet.</p>
          ) : (
            <ul className="pb-3">
              {log.map((c) => {
                const active = sel?.kind === "commit" && sel.sha === c.sha;
                return (
                  <li key={c.sha}>
                    <button
                      type="button"
                      onClick={() => setSel({ kind: "commit", sha: c.sha })}
                      className={`flex w-full flex-col gap-0.5 border-l-2 px-3 py-1.5 text-left ${
                        active ? "border-accent bg-accent-soft" : "border-transparent hover:bg-surface"
                      }`}
                    >
                      <span className="truncate text-[0.82rem] text-fg" title={c.message}>
                        {c.message}
                      </span>
                      <span className="flex items-center gap-1.5 text-[0.68rem] text-faint">
                        <code className="font-mono">{c.short}</code>
                        <span className="truncate">· {c.author}</span>
                        <span className="ml-auto shrink-0" title={c.isoDate}>
                          {c.relativeDate}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Right pane: the selected diff (a div, not <main> — the studio layout
            already owns the page's single <main> landmark). */}
        <section aria-label="Diff" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
          {!sel ? (
            <Notice>No history yet. Commit your first version to get started.</Notice>
          ) : (
            <div className="mx-auto w-full max-w-300 px-5 py-5">
              {/* Detail header */}
              {sel.kind === "worktree" ? (
                <div className="mb-4 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-fg">
                      {dirtyCount > 0 ? `Working tree — ${dirtyCount} uncommitted change${dirtyCount === 1 ? "" : "s"}` : "Working tree — clean"}
                    </h2>
                    {dirtyCount > 0 && (
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                        {changes.map((c) => (
                          <span key={c.path} className="font-mono">
                            {KIND_LABEL[c.kind] ?? c.kind}:{" "}
                            {(c.kind === "renamed" || c.kind === "copied") && c.origPath
                              ? `${c.origPath} → ${c.path}`
                              : c.path}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      // Only seed the default message when opening; don't clobber a draft.
                      if (!commitOpen) {
                        setCommitErr(null);
                        setMessage(log.length === 0 ? "Initial commit" : `Update ${data.dirName}`);
                      }
                      setCommitOpen((o) => !o);
                    }}
                    disabled={dirtyCount === 0 || !info.hasIdentity}
                    title={!info.hasIdentity ? "Set a git identity first" : dirtyCount === 0 ? "No changes to commit" : "Commit these changes"}
                    className="shrink-0 rounded-md bg-fg px-3 py-1.5 text-sm font-medium text-app transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Commit…
                  </button>
                </div>
              ) : (
                (() => {
                  // Header metadata comes from the commit list (always in sync with
                  // the selection); only the body comes from the lazily-loaded diff,
                  // and only once it matches the current selection.
                  const meta = selectedCommit ?? view.commit;
                  const body = view.commit && view.commit.sha === sel.sha ? view.commit.body : "";
                  const subject = selectedCommit?.message ?? view.commit?.subject;
                  if (!meta) return null;
                  return (
                    <div className="mb-4">
                      <h2 className="text-sm font-semibold text-fg">{subject}</h2>
                      {body && <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-muted">{body}</pre>}
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
                        <code className="font-mono text-muted">{meta.short}</code>
                        <span>·</span>
                        <span>{meta.author}</span>
                        <span>·</span>
                        <span title={meta.isoDate}>{meta.relativeDate}</span>
                      </p>
                    </div>
                  );
                })()
              )}

              {!info.hasIdentity && sel.kind === "worktree" && dirtyCount > 0 && (
                <p className="mb-3 rounded-md bg-panel px-2.5 py-2 text-xs text-warn">
                  Set a git identity to commit: <code className="font-mono">git config --global user.email "you@example.com"</code> (and{" "}
                  <code className="font-mono">user.name</code>).
                </p>
              )}

              {commitOpen && sel.kind === "worktree" && (
                <div className="mb-4 rounded-lg border border-border bg-app p-2.5">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        if (message.trim() && !committing) void doCommit();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setCommitOpen(false);
                      }
                    }}
                    rows={2}
                    autoFocus
                    placeholder="Describe this version… (⌘↵ to commit)"
                    className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    {commitErr && <span className="mr-auto text-xs text-danger">{commitErr}</span>}
                    <button
                      type="button"
                      onClick={() => setCommitOpen(false)}
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-panel"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={doCommit}
                      disabled={committing || !message.trim()}
                      className="rounded-md bg-fg px-3 py-1.5 text-sm font-medium text-app hover:opacity-90 disabled:opacity-40"
                    >
                      {committing ? "Committing…" : "Commit"}
                    </button>
                  </div>
                </div>
              )}

              {/* Diff body */}
              {view.loading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted">
                  <Spinner className="h-4 w-4" /> Loading diff…
                </div>
              ) : view.error ? (
                <p className="py-6 text-sm text-danger">{view.error}</p>
              ) : (
                <DiffView
                  diff={view.diff}
                  truncated={view.truncated}
                  emptyLabel={sel.kind === "worktree" ? "Working tree is clean — nothing to compare." : "This commit has no file changes."}
                />
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
