#!/bin/zsh
# Run the public-page smoke on this machine against local weights linked as te/ dit/ vae/, held awake.
# Usage: [KLEIN_CODE=<code dir>] [KLEIN_WEIGHTS=<dir with te/ dit/ vae/>] [KLEIN_KIT=<kit dir>] run-remote-page-smoke.sh <chrome-executable> <out-dir> [extra run-page-smoke args...]
# mem.log samples every 2 s: system free %, swap used, and GPU-allocated system memory (IOAccelerator).
set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
ROOT=${KLEIN_ROOT:-$HOME/.local/state/kaminos/thomas-jank-engine}
CODE=${KLEIN_CODE:-$ROOT/code}
WEIGHTS=${KLEIN_WEIGHTS:-$ROOT/weights-staged}
KIT=${KLEIN_KIT:-$ROOT/webgpu-inference-kit}
CHROME=$1; OUT=$2; shift 2
mkdir -p "$OUT"
caffeinate -dimsu -w $$ &
(while true; do echo "$(date +%T) $(memory_pressure -Q | tail -1 | awk '{print $NF}') swapused=$(sysctl -n vm.swapusage | awk '{print $6}') gpu=$(ioreg -r -d 1 -c IOAccelerator | grep -o '"In use system memory"=[0-9]*' | head -1 | cut -d= -f2)"; sleep 2; done) > "$OUT/mem.log" 2>&1 &
MEM=$!
node "$CODE/run-page-smoke.mjs" --chrome "$CHROME" --kit "$KIT" --weights-dir "$WEIGHTS" --out "$OUT" "$@" > "$OUT/run.log" 2>&1
STATUS=$?
kill $MEM 2>/dev/null
echo "exit=$STATUS code=$CODE code_rev=$(cat $CODE/CODE_REV) weights=$WEIGHTS kit=$KIT" >> "$OUT/run.log"
exit $STATUS
