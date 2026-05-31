"use client";

import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";

// Markdown styled "live": headings sized & bold, emphasis/links styled, while the
// markup markers (#, *, `, -) stay faint and visible — so it reads like a clean
// document yet remains the exact hand-authored markdown.
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.7em", fontWeight: "700", lineHeight: "1.3" },
  { tag: t.heading2, fontSize: "1.4em", fontWeight: "700", lineHeight: "1.3" },
  { tag: t.heading3, fontSize: "1.2em", fontWeight: "650" },
  { tag: t.heading4, fontSize: "1.05em", fontWeight: "650" },
  { tag: t.heading5, fontWeight: "650" },
  { tag: t.heading6, fontWeight: "650", color: "var(--muted)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)" },
  {
    tag: t.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "var(--code-bg)",
    borderRadius: "4px",
    padding: "0.05em 0.3em",
  },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: t.list, color: "var(--muted)" },
  // Faint markup punctuation (#, **, `, -, >, link brackets, ---).
  { tag: t.processingInstruction, color: "var(--faint)" },
  { tag: t.contentSeparator, color: "var(--faint)" },
  { tag: t.meta, color: "var(--faint)" },
]);

// Restrained code highlighting — deliberately low-contrast (less distinction).
const codeHighlight = HighlightStyle.define([
  { tag: t.comment, color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], fontWeight: "600" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--accent)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--accent)" },
  { tag: [t.typeName, t.className], fontWeight: "600" },
  { tag: t.meta, color: "var(--muted)" },
]);

const baseTheme = EditorView.theme({
  "&": { color: "var(--fg)", backgroundColor: "transparent" },
  ".cm-content": { padding: "0" },
  ".cm-gutters": { display: "none" },
});

function codeExtensions(language?: string): Extension[] {
  switch (language) {
    case "json":
      return [json()];
    case "yaml":
      return [yaml()];
    case "python":
      return [python()];
    case "javascript":
      return [javascript({ jsx: true })];
    case "typescript":
      return [javascript({ jsx: true, typescript: true })];
    default:
      return [];
  }
}

export default function LiveEditor({
  value,
  onChange,
  kind,
  language,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  /** "markdown" → styled live-markdown; "code" → restrained code editor. */
  kind: "markdown" | "code";
  language?: string;
  placeholder?: string;
}) {
  const extensions: Extension[] =
    kind === "markdown"
      ? [
          markdown({ base: markdownLanguage, codeLanguages: [] }),
          EditorView.lineWrapping,
          syntaxHighlighting(markdownHighlight),
          baseTheme,
        ]
      : [...codeExtensions(language), EditorView.lineWrapping, syntaxHighlighting(codeHighlight), baseTheme];

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      extensions={extensions}
      className={kind === "code" ? "cm-mono" : undefined}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        bracketMatching: false,
        closeBrackets: false,
        highlightSelectionMatches: false,
        searchKeymap: false,
        indentOnInput: false,
      }}
    />
  );
}
