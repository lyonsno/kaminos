#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
: "${KIMODO_WEBGPU_CHECKOUT:?Set KIMODO_WEBGPU_CHECKOUT to the committed Kimodo worktree with npm dependencies and public/kimodo.bin}"
node scripts/build-kimodo-shared-device.mjs "$KIMODO_WEBGPU_CHECKOUT"
PORT="${1:-8096}"
echo "Kimodo x live flame, one shared GPUDevice: http://127.0.0.1:$PORT/kimodo-shared-device.html"
echo "Kimodo embedding: http://127.0.0.1:8098/embed (allow origin http://127.0.0.1:$PORT)"
exec python3 serve.py "$PORT"
