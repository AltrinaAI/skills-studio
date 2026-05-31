"use client";

import { ThemeToggle } from "./ui";

export default function TopBar({
  onHome,
  skillName,
  selected,
  toggleTheme,
}: {
  onHome: () => void;
  skillName: string;
  selected: string | null;
  toggleTheme: () => void;
}) {
  return (
    <header className="z-20 flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm">
      <button
        type="button"
        onClick={onHome}
        title="Back to home"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-fg hover:bg-panel"
      >
        <span aria-hidden>📘</span>
        <span className="font-medium">Skill Viewer</span>
      </button>
      <span className="text-faint" aria-hidden>
        /
      </span>
      <span className="truncate font-medium text-fg">{skillName}</span>
      {selected && selected !== "SKILL.md" && (
        <>
          <span className="text-faint" aria-hidden>
            /
          </span>
          <span className="truncate font-mono text-xs text-muted">{selected}</span>
        </>
      )}
      <div className="ml-auto">
        <ThemeToggle onClick={toggleTheme} />
      </div>
    </header>
  );
}
