#!/bin/zsh
# Run the Klein generator batch on this machine against local weights, held awake.
# Usage: run-remote-box.sh <chrome-executable> <out-dir> [--only a,b] [extra run-generate args...]
# Expects code in $ROOT/code (models/flux2-klein) and weights in $ROOT/weights.
# Writes <out-dir>/report.json (from run-generate), <out-dir>/mem.log, <out-dir>/run.log.
set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
ROOT=${KLEIN_ROOT:-$HOME/.local/state/kaminos/thomas-jank-engine}
CHROME=$1; OUT=$2; shift 2
mkdir -p "$OUT"
W=$ROOT/weights; C=$ROOT/code
PORT=${KLEIN_PORT:-18719}
caffeinate -dimsu -w $$ &
node "$C/serve-klein.mjs" --port $PORT --kit "$ROOT/webgpu-inference-kit" --te "$W/klein4b-text-encoder-i4" --dit "$W/klein4b-transformer-i4" --vae "$W/klein4b-vae-decoder-f16" > "$OUT/server.log" 2>&1 &
SERVER=$!
(while true; do echo "$(date +%T) $(memory_pressure -Q | tail -1) swapused=$(sysctl -n vm.swapusage | awk '{print $6}')"; sleep 5; done) > "$OUT/mem.log" 2>&1 &
MEM=$!
sleep 1
node "$C/run-generate.mjs" --chrome "$CHROME" --origin "http://127.0.0.1:$PORT" --te "$W/klein4b-text-encoder-i4" --dit "$W/klein4b-transformer-i4" \
  --vae "$W/klein4b-vae-decoder-f16" --prompts "$C/prompts" --out "$OUT" "$@" > "$OUT/run.log" 2>&1
STATUS=$?
kill $MEM $SERVER 2>/dev/null
echo "exit=$STATUS" >> "$OUT/run.log"
exit $STATUS
