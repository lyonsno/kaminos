#!/usr/bin/env bash
# Operator-authorized run of the admitted-surface exporter (2026-08-05).
# Read-only against the source; writes only into this worktree's artifacts dir.
set -euo pipefail

WORKTREE=/private/tmp/kaminos-prometheus-envelope-relations-0805
SOURCE=/Users/noahlyons/dev/operator-scratch/blender-scenes/cat-bauplan.blend
CLASSIFICATION=/private/tmp/kaminos-molten-cat-analytical-carrier-0805/artifacts/cat-bauplan-analytical-carrier-v0/source-preview-r2-complete/classification.json
OUTDIR="$WORKTREE/artifacts/envelope-relation-v0/source-surfaces"

cd "$WORKTREE"
mkdir -p "$OUTDIR"

exec /Applications/Blender.app/Contents/MacOS/Blender --background "$SOURCE" \
  --python "$WORKTREE/tools/blender-export-admitted-surfaces.py" \
  -- \
  --source "$SOURCE" \
  --classification "$CLASSIFICATION" \
  --out "$OUTDIR/admitted-surfaces.json" \
  --manifest "$OUTDIR/manifest.json" \
  --failure "$OUTDIR/failure.json" \
  --expected-source-sha256 9453608cdf721ee98ad2924ac16a459b7b810d96159566133e7a573327b9744c
