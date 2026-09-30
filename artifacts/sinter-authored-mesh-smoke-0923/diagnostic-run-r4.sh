#!/bin/bash
set -euo pipefail

repo_root="${1:?repo root required}"
scene_path="${2:?scene path required}"
out_dir="${3:?output dir required}"
port="${4:?server port required}"
origin="http://127.0.0.1:${port}"

cd "$repo_root"
mkdir -p "$out_dir"
if curl --silent --fail --max-time 2 "$origin/api/runtime-config" >/dev/null; then
  echo "Kaminos capture port is already serving an unknown process: $origin" >&2
  exit 1
fi

python3 serve.py "$port" >"$out_dir/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT
until curl --silent --fail --max-time 2 "$origin/api/runtime-config" >/dev/null; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Kaminos server exited before capture" >&2
    exit 1
  fi
  sleep 0.25
done

/opt/homebrew/bin/node artifacts/sinter-authored-mesh-smoke-0923/diagnostic-capture-r3.mjs \
  --repo-root "$repo_root" --scene "$scene_path" --origin "$origin" --out-dir "$out_dir"
