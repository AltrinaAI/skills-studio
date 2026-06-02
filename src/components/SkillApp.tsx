"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import Home from "./Home";
import TerminalsWorkspace from "./TerminalsWorkspace";
import SkillDocument from "./SkillDocument";
import FilePane from "./FilePane";
import ManagePanel from "./ManagePanel";
import ExportDialog from "./ExportDialog";
import { Spinner } from "./ui";
import { addRecent } from "./recents";
import { confirmDiscardIfDirty, isEditorDirty } from "./editorState";
import { reconcileRequiredEnv, runSaveHooks } from "./saveHooks";
import { skillKind } from "@/lib/agents";
import { requiredEnv } from "@/lib/skill";
import * as api from "@/lib/api";
import type { SkillData, FileData } from "@/lib/types";

function skillName(d: SkillData): string {
  return typeof d.frontmatter.name === "string" && d.frontmatter.name ? d.frontmatter.name : d.dirName;
}

export default function SkillApp({
  initialPath,
  initialData = null,
  initialError = null,
}: {
  initialPath?: string;
  initialData?: SkillData | null;
  initialError?: string | null;
}) {
  const [data, setData] = useState<SkillData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialError);

  const [selected, setSelected] = useState<string | null>("SKILL.md");
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [terminalsOpen, setTerminalsOpen] = useState(false);
  // Bumped when we replace `data` for the *same* root (e.g. a post-save hook
  // rewrites SKILL.md) so the mount-initialized editor remounts with it.
  const [docVersion, setDocVersion] = useState(0);
  const reqRef = useRef(0);
  // Live `data` for async callbacks (post-save hooks) that resolve after the
  // user may have navigated elsewhere.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });

  const toggleTheme = useCallback(() => {
    const isDark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("skillviewer-theme", isDark ? "dark" : "light");
    } catch {}
  }, []);

  // Record a deep-linked / SSR-loaded skill in recents once. (Auto-declare runs
  // in the load path below; SSR-provided `initialData` isn't used in this app,
  // so we don't reconcile here — doing so safely would need a same-root editor
  // remount + a navigation guard, and there's no live path that exercises it.)
  useEffect(() => {
    if (initialData) addRecent({ root: initialData.root, name: skillName(initialData) });
  }, [initialData]);

  const loadSkill = useCallback(async (p: string) => {
    if (!p.trim()) return;
    setLoading(true);
    setLoadError(null);
    try {
      // Reconcile required-env on open so the declaration is current before edits.
      const { data: sd } = await reconcileRequiredEnv(p);
      setData(sd);
      setSelected("SKILL.md");
      setFileData(null);
      setFileError(null);
      addRecent({ root: sd.root, name: skillName(sd) });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load skill");
    } finally {
      setLoading(false);
    }
  }, []);

  // Open a deep-linked skill (?path=) once on mount.
  useEffect(() => {
    if (initialPath && !initialData) void loadSkill(initialPath);
  }, [initialPath, initialData, loadSkill]);

  const goHome = useCallback(() => {
    if (!confirmDiscardIfDirty()) return;
    setData(null);
    setSelected("SKILL.md");
    setFileData(null);
    setFileError(null);
    setLoadError(null);
  }, []);

  // After a delete the folder is gone — drop back to Home without the
  // unsaved-changes prompt (any pending edit is moot).
  const afterDelete = useCallback(() => {
    setManageOpen(false);
    setData(null);
    setSelected("SKILL.md");
    setFileData(null);
    setFileError(null);
    setLoadError(null);
  }, []);

  // Runs after every successful save: fire the post-save pipeline (today, the
  // managed-secret → required-env scan). If a hook rewrote + reloaded the skill,
  // swap the fresh data in — but only when we're still on the same skill, and
  // remount the editor (docVersion bump) only when it isn't mid-edit, so we
  // never discard keystrokes typed in the window after the save. (When the
  // editor IS mid-edit we keep its buffer and skip the remount; the on-disk
  // required-env may briefly trail the editor, but the next save re-detects and
  // re-adds it — the scan reads the files, which still hold the reference.)
  // `saveSeq` drops a stale reconcile if a newer save started before it resolved.
  const saveSeq = useRef(0);
  const afterSave = useCallback(async () => {
    if (!data) return;
    const seq = ++saveSeq.current;
    const rel = selected === "SKILL.md" ? null : selected;
    const effects = await runSaveHooks({ root: data.root, kind: skillKind(data.root).kind, rel });
    if (seq !== saveSeq.current) return; // a newer save superseded this one
    let reloaded: SkillData | undefined;
    for (const e of effects) if (e.reloaded) reloaded = e.reloaded;
    if (reloaded && dataRef.current?.root === reloaded.root) {
      setData(reloaded);
      if (!isEditorDirty()) setDocVersion((v) => v + 1);
    }
  }, [data, selected]);

  // Skills with no declared env can export in one click; otherwise the dialog
  // surfaces the bundle-secrets option and the not-bundled warning.
  const onExport = useCallback(() => {
    if (!data) return;
    if (requiredEnv(data.frontmatter).length === 0) void api.exportZip(data.root);
    else setExportOpen(true);
  }, [data]);

  const selectFile = useCallback(
    async (rel: string) => {
      if (!data || rel === selected) return;
      if (!confirmDiscardIfDirty()) return;
      const myReq = ++reqRef.current;
      setSelected(rel);
      if (rel === "SKILL.md") {
        setFileData(null);
        setFileError(null);
        setFileLoading(false);
        return;
      }
      setFileLoading(true);
      setFileError(null);
      setFileData(null);
      try {
        const fd = await api.readFile(data.root, rel);
        if (myReq !== reqRef.current) return;
        setFileData(fd);
      } catch (e) {
        if (myReq !== reqRef.current) return;
        setFileError(e instanceof Error ? e.message : "Failed to read file");
      } finally {
        if (myReq === reqRef.current) setFileLoading(false);
      }
    },
    [data, selected],
  );

  if (!data) {
    if (terminalsOpen) {
      return <TerminalsWorkspace onClose={() => setTerminalsOpen(false)} toggleTheme={toggleTheme} />;
    }
    return (
      <Home
        onOpen={loadSkill}
        loading={loading}
        error={loadError}
        toggleTheme={toggleTheme}
        onOpenTerminals={() => setTerminalsOpen(true)}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col bg-app text-fg">
      <TopBar
        onHome={goHome}
        skillName={skillName(data)}
        selected={selected}
        onManage={() => setManageOpen(true)}
        onExport={onExport}
        toggleTheme={toggleTheme}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar data={data} selected={selected} onSelect={selectFile} />
        <main className="min-w-0 flex-1 overflow-auto">
          {selected === "SKILL.md" ? (
            <SkillDocument key={`${data.root}:${docVersion}`} data={data} onSaved={afterSave} />
          ) : fileLoading ? (
            <div role="status" aria-live="polite" className="flex h-full items-center justify-center text-muted">
              <Spinner /> <span className="ml-2">Loading file…</span>
            </div>
          ) : fileError ? (
            <p className="px-8 py-8 text-sm text-danger">{fileError}</p>
          ) : fileData ? (
            <FilePane key={fileData.rel} root={data.root} file={fileData} onSaved={afterSave} />
          ) : null}
        </main>
      </div>
      {manageOpen && (
        <ManagePanel
          root={data.root}
          dirName={data.dirName}
          kind={skillKind(data.root).kind}
          onClose={() => setManageOpen(false)}
          onDeleted={afterDelete}
        />
      )}
      {exportOpen && (
        <ExportDialog
          root={data.root}
          dirName={data.dirName}
          declared={requiredEnv(data.frontmatter)}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
