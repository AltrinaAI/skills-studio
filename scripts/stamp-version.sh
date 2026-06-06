#!/usr/bin/env bash
# Stamp a version into the ONE source of truth: [workspace.package].version in the root
# Cargo.toml. Every crate inherits it (`version.workspace = true`) and the Tauri app
# reads it via CARGO_PKG_VERSION (tauri.conf.json has no `version`), so this single edit
# sets the version for the whole repo — all crates, the desktop app/bundle names, and the
# standalone skill-server. Called by CI on a tag push (.github/workflows/release.yml);
# the committed value is a `0.0.0` dev placeholder.
#
#   scripts/stamp-version.sh 0.1.6
set -euo pipefail

version="${1:?usage: stamp-version.sh <version>}"
root="$(cd "$(dirname "$0")/.." && pwd)"

# The root Cargo.toml has exactly one top-level `version = "…"` line (under
# [workspace.package]); members use `version.workspace = true`, which this won't match.
# `-i.bak` + rm is portable across GNU (Linux) and BSD (macOS) sed.
sed -i.bak -E "s/^version = \"[^\"]*\"/version = \"${version}\"/" "$root/Cargo.toml"
rm -f "$root/Cargo.toml.bak"

echo "Stamped workspace version → $(grep -m1 '^version' "$root/Cargo.toml")"
