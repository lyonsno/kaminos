#!/bin/bash
# Serve this checkout with the mounted elfinblue-fuckeryyy basin store bound
# and the SF3D producer library's large assets linked in from an SF3D checkout
# (the library build vendors only code; weights.bin 2.13 GB and the tet grid
# ~50 MB are served from the checkout, never committed here).
# Usage: SF3D_WEBGPU_CHECKOUT=/path/to/sf3d-webgpu ./serve-sf3d-elfinblue.sh [port]   (default 8095)
cd "$(dirname "$0")"
PORT="${1:-8095}"
SF3D="${SF3D_WEBGPU_CHECKOUT:-/private/tmp/sf3d-webgpu-slow-kit-0148-0915}"
for asset in weights.bin tets; do
  if [ ! -e "lib/sf3d/$asset" ]; then
    [ -e "$SF3D/public/$asset" ] || { echo "missing $SF3D/public/$asset (set SF3D_WEBGPU_CHECKOUT)"; exit 2; }
    ln -s "$SF3D/public/$asset" "lib/sf3d/$asset"
  fi
done
export KAMINOS_VOLUME_SETTINGS_STORE="$PWD/artifacts/basin-mounts/settings-store"
echo "store: $KAMINOS_VOLUME_SETTINGS_STORE"
echo "sf3d assets: lib/sf3d/weights.bin -> $(readlink lib/sf3d/weights.bin)"
echo "entry: http://127.0.0.1:$PORT/sf3d-elfinblue.html"
exec python3 serve.py "$PORT"
