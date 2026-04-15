#!/usr/bin/env bash
# Mirror the sherwood skill pack into hermes-plugin/skills/sherwood-agent.
# Run from hermes-plugin/ directory.
set -euo pipefail

SRC="${1:-../skill}"
DEST="skills/sherwood-agent"

if [[ ! -d "$SRC" ]]; then
    echo "source not found: $SRC" >&2
    exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC"/* "$DEST"/
echo "skill pack mirrored from $SRC to $DEST"
