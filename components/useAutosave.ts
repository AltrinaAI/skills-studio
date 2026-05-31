"use client";

import { useEffect, useRef, useState } from "react";

export type SaveStatus = "saved" | "editing" | "saving" | "error";

/**
 * Debounced autosave for a derived string `value`.
 * - Saves `delay` ms after the value stops changing.
 * - `save` is called with the latest value; it should persist and resolve.
 * - Flushes a pending change on unmount so switching away never drops an edit.
 */
export function useAutosave(
  value: string,
  save: (value: string) => Promise<void>,
  delay = 800,
) {
  const [savedValue, setSavedValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveRef = useRef(save);
  const valueRef = useRef(value);
  const savedRef = useRef(value);

  useEffect(() => {
    saveRef.current = save;
    valueRef.current = value;
    savedRef.current = savedValue;
  });

  // Debounced save whenever the value diverges from what's on disk.
  useEffect(() => {
    if (value === savedValue) return;
    const id = setTimeout(() => {
      setSaving(true);
      Promise.resolve(saveRef.current(value))
        .then(() => {
          setSavedValue(value);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Save failed"))
        .finally(() => setSaving(false));
    }, delay);
    return () => clearTimeout(id);
  }, [value, savedValue, delay]);

  // Flush the latest unsaved value on unmount.
  useEffect(() => {
    return () => {
      if (valueRef.current !== savedRef.current) {
        void saveRef.current(valueRef.current).catch(() => {});
      }
    };
  }, []);

  const dirty = value !== savedValue;
  const status: SaveStatus = error ? "error" : saving ? "saving" : dirty ? "editing" : "saved";
  return { status, error, dirty };
}
