#!/usr/bin/env bash
# One-command local hand demo. Runtime code is pinned; models come from upstream.
set -eu
hand_state_dir="${KAMINOS_HAND_HOME:-$HOME/.local/share/kaminos/hand-demo}"
mkdir -p "$hand_state_dir"
hand_phase=bootstrap
trap 'hand_status=$?; if [ "$hand_status" -ne 0 ]; then printf "Setup stopped during %s (exit %s). Rerun the same command.\n" "$hand_phase" "$hand_status" > "$hand_state_dir/bootstrap-error.txt"; fi' EXIT
command -v curl >/dev/null 2>&1 || { echo 'curl is required. Install it and rerun this command.' >&2; exit 1; }
case "$(uname -s)" in Darwin|Linux) ;; *) echo 'This launcher supports macOS and Linux.' >&2; exit 1;; esac
if command -v uv >/dev/null 2>&1; then
  hand_uv="$(command -v uv)"
elif [ -x "$hand_state_dir/tools/uv" ]; then
  hand_uv="$hand_state_dir/tools/uv"
else
  hand_phase=python-runner-install
  echo 'Installing a private Python runner (uv). Shell profiles are unchanged.'
  curl -fLSs https://astral.sh/uv/install.sh -o "$hand_state_dir/uv-installer.sh"
  UV_UNMANAGED_INSTALL="$hand_state_dir/tools" sh "$hand_state_dir/uv-installer.sh"
  hand_uv="$hand_state_dir/tools/uv"
fi
hand_phase=setup-download
curl -fLSs "https://raw.githubusercontent.com/lyonsno/kaminos/ab4e045412a4494e2c0149883f8f8b25b77d7de2/demos/hand-mesh/setup.py" -o "$hand_state_dir/setup.py.download"
if command -v shasum >/dev/null 2>&1; then
  hand_digest="$(shasum -a 256 "$hand_state_dir/setup.py.download")"
else
  hand_digest="$(sha256sum "$hand_state_dir/setup.py.download")"
fi
case "$hand_digest" in '3ada9e522077d7ab103f15398cc8b30ad47517f4241b339ce9a5749b8feed80e '*) ;; *) echo 'Setup source checksum differs; download retained for inspection.' >&2; exit 1;; esac
mv "$hand_state_dir/setup.py.download" "$hand_state_dir/setup.py"
hand_phase=python-and-demo
"$hand_uv" run --python 3.12 --script "$hand_state_dir/setup.py" --state-dir "$hand_state_dir" --revision ab4e045412a4494e2c0149883f8f8b25b77d7de2 "$@"
