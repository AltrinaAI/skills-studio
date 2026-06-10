"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import * as api from "@/lib/api";
import { log } from "@/lib/log";

/** Reject pasted images larger than this client-side, matching the server cap in
 *  `save_pasted_image`, so an over-limit paste fails instantly instead of after a
 *  full encode-and-upload through the tunnel. */
const MAX_PASTE_BYTES = 32 * 1024 * 1024;

// Pull terminal colors from the app's CSS variables so it tracks the theme.
function themeFromCss(): Record<string, string | undefined> {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => {
    const s = css.getPropertyValue(n).trim();
    return s || undefined;
  };
  return {
    background: v("--surface") ?? v("--bg"),
    foreground: v("--fg"),
    cursor: v("--accent"),
    cursorAccent: v("--surface"),
    selectionBackground: v("--sel"),
  };
}

/**
 * A live terminal view bound to one tmux-backed session. Mounting attaches;
 * unmounting detaches (the session keeps running). Remount with a new `id`
 * (via `key`) to switch sessions.
 */
export default function TerminalPane({ id, visible = true }: { id: string; visible?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Refreshed on each (re)attach; invoked when the pane becomes visible again.
  const refitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      scrollback: 8000,
      // With `mouse on` (set server-side so the wheel scrolls tmux scrollback),
      // tmux owns drag-selection — so give the user a native-selection escape
      // hatch that doesn't depend on the OSC 52 clipboard hop below: Shift+drag
      // (xterm's default) everywhere, and Option+drag on macOS.
      macOptionClickForcesSelection: true,
      theme: themeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // tmux owns the scrollback (wheel → copy-mode); copying there arrives as an
    // OSC 52 write — honor it so copy-mode copies land on the system clipboard.
    term.parser.registerOscHandler(52, (data) => {
      const semi = data.indexOf(";");
      const payload = semi < 0 ? "" : data.slice(semi + 1);
      if (!payload || payload === "?") return true; // never answer clipboard *reads*
      let text: string;
      try {
        text = new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)));
      } catch {
        return true; // malformed base64
      }
      // writeText rejects asynchronously, so a try/catch can't see it. The webview
      // may also deny it: WKWebView gates the async clipboard on a user gesture,
      // and this fires from the SSE stream (no gesture) — so it can silently fail
      // on the macOS desktop. Catch the rejection (no unhandled-rejection noise);
      // the Shift/Option+drag native-selection path above is the reliable fallback.
      navigator.clipboard?.writeText(text).catch((e) => log.debug("term", "OSC52 clipboard write denied", e));
      return true;
    });
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* host not laid out yet */
    }

    const handle = api.attachTerminal(id, {
      cols: term.cols,
      rows: term.rows,
      onData: (bytes) => term.write(bytes),
      onClose: () => term.write("\r\n\x1b[2m[disconnected — the session may have ended]\x1b[0m\r\n"),
    });
    const dataSub = term.onData((d) => handle.write(d));

    // Images can't ride the text paste path: ship the bytes to the backend
    // (where the agent runs — possibly a remote host with no access to this
    // machine's clipboard) and paste the returned file path, the same shape
    // drag-and-drop produces in a native terminal. When the clipboard carries
    // both text and an image (e.g. spreadsheet cells), text wins and xterm's
    // own paste handler takes it.
    let gone = false;
    const note = (msg: string) => {
      if (!gone) term.write(`\r\n\x1b[2m[${msg}]\x1b[0m\r\n`);
    };
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      const img = dt && Array.from(dt.items).find((it) => it.kind === "file" && it.type.startsWith("image/"));
      if (!img || dt.getData("text/plain")) return;
      e.preventDefault();
      e.stopPropagation();
      const file = img.getAsFile();
      if (!file) return;
      // Capture the mime NOW: the File snapshot keeps its type, but the
      // DataTransferItem is neutered once this handler returns, so `img.type`
      // reads "" after the first await — which the server's allowlist rejects.
      const mime = file.type || img.type;
      // Reject oversized images here, before encoding ~1.33× their bytes into a
      // JSON body and shipping it through the SSH tunnel only for the server's
      // identical cap to 400 it. Keep the limit in sync with save_pasted_image.
      if (file.size > MAX_PASTE_BYTES) {
        note("image too large (max 32 MB)");
        return;
      }
      void (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { path } = await api.terminalPasteImage(bytes, mime);
          if (!gone) term.paste(path);
        } catch (err) {
          note(`couldn't paste image: ${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    };
    host.addEventListener("paste", onPaste, true);

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          fit.fit();
          handle.resize(term.cols, term.rows);
        } catch {
          /* transient zero-size during layout */
        }
      });
    });
    ro.observe(host);
    term.focus();

    refitRef.current = () => {
      try {
        fit.fit();
        handle.resize(term.cols, term.rows);
      } catch {
        /* transient zero-size during layout */
      }
    };

    return () => {
      gone = true;
      host.removeEventListener("paste", onPaste, true);
      cancelAnimationFrame(raf);
      ro.disconnect();
      dataSub.dispose();
      handle.detach();
      term.dispose();
      refitRef.current = () => {};
    };
  }, [id]);

  // Kept alive across navigation via display:none, where the host has zero size
  // and fit() can't measure; re-fit (and resize the pty) once shown again.
  useEffect(() => {
    if (visible) requestAnimationFrame(() => refitRef.current());
  }, [visible]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-surface p-1.5" />;
}
