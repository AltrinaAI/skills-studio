// Backend bridge with two transports:
//   • Desktop (Tauri): in-process `invoke`.
//   • Browser (served by skill-server, e.g. backend in WSL2): `fetch('/api/...')`.
// Auto-detected at runtime. YAML parse/validate stays here in TS (lib/skill).
import { invoke } from "@tauri-apps/api/core";
import {
  parseSkillMd,
  serializeSkillMd,
  validateSkill,
  estimateTokens,
  countLines,
  type SkillFrontmatter,
} from "@/lib/skill";
import type { SkillData, FileData, TreeNode } from "@/lib/types";

/** True when running inside the Tauri desktop shell (vs a plain browser). */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Same-origin by default (server serves the UI + /api). Override for dev with
// VITE_API_BASE (e.g. point a Vite dev server at a remote skill-server).
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function http<T>(method: "GET" | "POST", path: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/api/${path}`, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(args ?? {}) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json && json.error) || `Request failed (${res.status})`);
  return json as T;
}

interface RawSkill {
  root: string;
  dirName: string;
  raw: string;
  tree: TreeNode[];
  files: string[];
  fileCount: number;
  dirCount: number;
  totalBytes: number;
}

// --- raw command transports ---
const readSkillRaw = (path: string) =>
  isTauri ? invoke<RawSkill>("read_skill", { path }) : http<RawSkill>("POST", "read-skill", { path });

export const readFile = (root: string, rel: string) =>
  isTauri ? invoke<FileData>("read_file", { root, rel }) : http<FileData>("POST", "read-file", { root, rel });

export const writeFile = (root: string, rel: string, content: string) =>
  isTauri
    ? invoke<void>("write_file", { root, rel, content })
    : http<void>("POST", "write-file", { root, rel, content });

const readImage = (root: string, rel: string) =>
  isTauri
    ? invoke<{ mime: string; base64: string }>("read_image_base64", { root, rel })
    : http<{ mime: string; base64: string }>("POST", "read-image", { root, rel });

export const discoverSkills = () =>
  isTauri ? invoke<AgentSkills[]>("discover_skills") : http<AgentSkills[]>("GET", "discover");

// --- composed helpers ---
export async function loadSkill(path: string): Promise<SkillData> {
  const r = await readSkillRaw(path);
  const parsed = parseSkillMd(r.raw);
  const validation = validateSkill({
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    hasFrontmatter: parsed.hasFrontmatter,
    parseError: parsed.parseError,
    dirName: r.dirName,
    files: r.files,
  });
  return {
    root: r.root,
    dirName: r.dirName,
    raw: r.raw,
    frontmatter: parsed.frontmatter,
    frontmatterRaw: parsed.frontmatterRaw,
    body: parsed.body,
    hasFrontmatter: parsed.hasFrontmatter,
    parseError: parsed.parseError,
    tree: r.tree,
    files: r.files,
    validation,
    stats: {
      bodyLines: countLines(parsed.body),
      bodyTokens: estimateTokens(parsed.body),
      fileCount: r.fileCount,
      dirCount: r.dirCount,
      totalBytes: r.totalBytes,
    },
  };
}

export async function saveSkillMd(root: string, frontmatter: SkillFrontmatter, body: string): Promise<void> {
  await writeFile(root, "SKILL.md", serializeSkillMd(frontmatter, body));
}

export async function imageDataUrl(root: string, rel: string): Promise<string> {
  const { mime, base64 } = await readImage(root, rel);
  return `data:${mime};base64,${base64}`;
}

/** Export the skill as a .zip — native save dialog (desktop) or browser download. */
export async function exportZip(root: string): Promise<void> {
  if (isTauri) {
    await invoke<boolean>("export_skill_zip", { root });
    return;
  }
  const a = document.createElement("a");
  a.href = `${API_BASE}/api/download?root=${encodeURIComponent(root)}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Native folder dialog — desktop only (browser uses the FolderPicker modal + listDir). */
export const pickSkillFolder = () => invoke<string | null>("pick_skill_folder");

// --- remote folder browsing (browser mode) ---
export interface DirEntry {
  name: string;
  isDir: boolean;
  isSkill: boolean;
}
export interface DirListing {
  path: string;
  parent: string | null;
  entries: DirEntry[];
}
export const listDir = (path: string) => http<DirListing>("POST", "list-dir", { path });

export interface DiscoveredSkill {
  name?: string;
  description?: string;
  root: string;
  sourceLabel: string;
}
export interface AgentSkills {
  agent: string;
  skills: DiscoveredSkill[];
}
