"use client";

import type { ReactNode } from "react";
import { TerminalMark } from "./FileIcon";

// The single top-chrome component shared by Home and the skill view, so the bar
// keeps a constant height (no shift when navigating into a skill). Pass a
// `breadcrumb` (rendered after the brand) and right-aligned actions as children.
export default function NavBar({
  onHome,
  breadcrumb,
  children,
}: {
  onHome?: () => void;
  breadcrumb?: ReactNode;
  children?: ReactNode;
}) {
  const brand = (
    <span className="flex items-center gap-1.5">
      <TerminalMark className="h-4.5 w-auto text-fg" />
      <span className="font-medium text-fg">Skill Studio</span>
    </span>
  );

  return (
    <header className="z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 text-sm">
      {onHome ? (
        <button
          type="button"
          onClick={onHome}
          title="Back to home"
          className="flex items-center rounded-md px-1.5 py-1 hover:bg-panel"
        >
          {brand}
        </button>
      ) : (
        <span className="px-1.5">{brand}</span>
      )}
      {breadcrumb}
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </header>
  );
}
