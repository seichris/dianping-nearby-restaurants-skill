#!/usr/bin/env bash
set -euo pipefail

SKILL_NAME="dianping-taocan-discovery"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
DEST_DIR="$CODEX_HOME/skills/$SKILL_NAME"

mkdir -p "$DEST_DIR"
rsync -a "$REPO_DIR/SKILL.md" "$DEST_DIR/"
rsync -a --delete --exclude install-codex-skill.sh "$REPO_DIR/scripts/" "$DEST_DIR/scripts/"
rsync -a --delete "$REPO_DIR/agents/" "$DEST_DIR/agents/"
rm -f "$DEST_DIR/scripts/install-codex-skill.sh"

echo "Installed $SKILL_NAME to $DEST_DIR"
