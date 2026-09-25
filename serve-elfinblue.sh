#!/bin/bash
# Serve this checkout with the mounted elfinblue-fuckeryyy basin store bound,
# so the package loader route (and /moge-elfinblue.html) resolves its preset.
# Usage: ./serve-elfinblue.sh [port]   (default 8094)
cd "$(dirname "$0")"
PORT="${1:-8094}"
export KAMINOS_VOLUME_SETTINGS_STORE="$PWD/artifacts/basin-mounts/settings-store"
echo "store: $KAMINOS_VOLUME_SETTINGS_STORE"
echo "entry: http://127.0.0.1:$PORT/moge-elfinblue.html"
exec python3 serve.py "$PORT"
