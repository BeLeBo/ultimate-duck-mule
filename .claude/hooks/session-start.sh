#!/bin/bash
# Richtet Graphify in Claude-Code-Cloud-Sitzungen ein und baut den
# Wissensgraphen des Spielcodes (graphify-out/). Lokal passiert nichts -
# dort einmalig selbst installieren (siehe README, Abschnitt Graphify).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

export PATH="$HOME/.local/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

# Gleiche Version wie der eingecheckte Skill (.claude/skills/graphify)
version=$(tr -d '[:space:]' < .claude/skills/graphify/.graphify_version)

if ! graphify --version 2>/dev/null | grep -qx "graphify $version"; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install --quiet --force "graphifyy==$version" >&2 || true
  else
    python3 -m pip install --quiet --user "graphifyy==$version" >&2 || true
  fi
fi

if ! command -v graphify >/dev/null 2>&1; then
  echo "Graphify konnte nicht installiert werden - weiter ohne Wissensgraph." >&2
  exit 0
fi

# Nur Code, lokal per AST - kein API-Key noetig, dauert ~2 Sekunden
if graphify update . >&2; then
  echo "Graphify $version bereit: Wissensgraph in graphify-out/ (graphify query/path/explain)."
else
  echo "graphify update ist fehlgeschlagen - weiter ohne Wissensgraph." >&2
fi
