#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
: "${KIMODO_WEBGPU_CHECKOUT:?Set KIMODO_WEBGPU_CHECKOUT to the clean Kimodo source checkout with npm dependencies and public/kimodo.bin}"
node scripts/build-kimodo-live-flame.mjs "$KIMODO_WEBGPU_CHECKOUT"
export KAMINOS_VOLUME_SETTINGS_STORE="$PWD/artifacts/basin-mounts/settings-store"
PORT="${1:-8096}"
echo "Kimodo x Elfinblue: http://127.0.0.1:$PORT/kimodo-elfinblue.html"
echo "Kimodo embedding: http://127.0.0.1:8098/embed (start Kimodo's tools/embed_server.py separately)"
exec python3 serve.py "$PORT"
