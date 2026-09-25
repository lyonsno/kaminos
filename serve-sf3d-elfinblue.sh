#!/bin/bash
# Run the authored kiln + stationary basin + current shared-device SF3D module.
# The source scene and basin are copied into an isolated route/store; generated
# GLBs remain content-addressed in the operator's durable Kaminos asset root.
# Usage: ./serve-sf3d-elfinblue.sh [port] (default 8170)
cd "$(dirname "$0")"
PORT="${1:-8170}"
SF3D="${SF3D_WEBGPU_CHECKOUT:-$HOME/dev/sf3d-webgpu}"
PRESET_ID="vsp-ea871168216fe29f6b79f27e01a644858213ec741e3506884343e4cb04eb9497"
PRESET_SOURCE="${KAMINOS_WAKE_KILN_PRESET_SOURCE:-$HOME/.local/share/kaminos/wake-composition-basins/presets/$PRESET_ID.json}"
SCENE_SOURCE="${KAMINOS_WAKE_KILN_SCENE_SOURCE:-$HOME/.local/share/kaminos/wake-compositions/refractory-kiln-stable-source-0924.kaminos.json}"
RUNTIME="${KAMINOS_WAKE_RUNTIME_DIR:-/private/tmp/kaminos-wake-kiln-current-main-runtime}"
SCENE_NAME="refractory-kiln-current-main-0925.kaminos.json"
for asset in weights.bin tets; do
  if [ ! -e "lib/sf3d/$asset" ]; then
    [ -e "$SF3D/public/$asset" ] || { echo "missing $SF3D/public/$asset (set SF3D_WEBGPU_CHECKOUT)"; exit 2; }
    ln -s "$SF3D/public/$asset" "lib/sf3d/$asset"
  fi
done
test -f "$PRESET_SOURCE" || { echo "missing authored basin preset: $PRESET_SOURCE"; exit 2; }
test -f "$SCENE_SOURCE" || { echo "missing authored kiln composition: $SCENE_SOURCE"; exit 2; }
mkdir -p "$RUNTIME/settings/presets" "$RUNTIME/basin-sessions" "$RUNTIME/cockpit-layouts"
PRESET_TARGET="$RUNTIME/settings/presets/$PRESET_ID.json"
SCENE_TARGET="scenes/$SCENE_NAME"
for pair in "$PRESET_SOURCE:$PRESET_TARGET" "$SCENE_SOURCE:$SCENE_TARGET"; do
  source="${pair%%:*}"
  target="${pair#*:}"
  if [ ! -f "$target" ]; then
    cp "$source" "$target"
  elif ! cmp -s "$source" "$target"; then
    echo "authored source differs from existing isolated copy: $target" >&2
    exit 3
  fi
done
PRESET_TARGET_ROUTE="$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { buildVolumeSettingsPresetTarget, validateVolumeSettingsPresetDocument } from "./volume-settings-preset-contract.mjs";
  const id = process.argv[1];
  const artifact = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const schema = JSON.parse(readFileSync("volume-settings-preset-schema-v2.json", "utf8"));
  const receipt = validateVolumeSettingsPresetDocument(artifact, id, schema);
  const target = buildVolumeSettingsPresetTarget(receipt, `http://127.0.0.1:${process.argv[3]}`);
  process.stdout.write(target.pathname + target.search);
' "$PRESET_ID" "$PRESET_SOURCE" "$PORT")"
case "$PRESET_TARGET_ROUTE" in
  /\?*) ;;
  *) echo "invalid preset cockpit route: $PRESET_TARGET_ROUTE" >&2; exit 3 ;;
esac
ROUTE_URL="http://127.0.0.1:$PORT$PRESET_TARGET_ROUTE#authoring=1&scene=$SCENE_NAME&volume_light_field=1&volume_light_field_scene_depth=1&composition_module_url=./sf3d-live-flame-inject.mjs"
export KAMINOS_VOLUME_SETTINGS_STORE="$RUNTIME/settings"
export KAMINOS_GENERATED_MESH_DIR="${KAMINOS_GENERATED_MESH_DIR:-$HOME/.local/state/kaminos/assets/generated-meshes}"
echo "isolated settings: $KAMINOS_VOLUME_SETTINGS_STORE"
echo "durable generated meshes: $KAMINOS_GENERATED_MESH_DIR"
echo "sf3d assets: lib/sf3d/weights.bin -> $(readlink lib/sf3d/weights.bin)"
echo "scene copy: scenes/$SCENE_NAME (source unchanged)"
echo "route: $ROUTE_URL"
exec python3 serve.py "$PORT" \
  --volume-settings-store "$KAMINOS_VOLUME_SETTINGS_STORE" \
  --volume-basin-session-store "$RUNTIME/basin-sessions" \
  --volume-cockpit-layout-store "$RUNTIME/cockpit-layouts"
