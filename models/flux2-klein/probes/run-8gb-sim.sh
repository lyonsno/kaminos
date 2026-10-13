#!/bin/zsh
# Page smoke under simulated 8 GB memory: memory-ballast.py locks RAM so the browser and macOS have
# about LEAVE_GB (default 4.5) left, then run-remote-page-smoke.sh runs with the given arguments.
# Usage: [LEAVE_GB=4.5] run-8gb-sim.sh <chrome-executable> <out-dir> [run-page-smoke args...]
set -u
HERE=${0:A:h}
OUT=$2
mkdir -p "$OUT"
python3 "$HERE/memory-ballast.py" --leave-gb "${LEAVE_GB:-4.5}" --status "$OUT/ballast.json" &
BALLAST=$!
for i in {1..300}; do grep -q '"holding"' "$OUT/ballast.json" 2>/dev/null && break; sleep 1; done
grep -q '"holding"' "$OUT/ballast.json" || { echo "ballast did not reach holding"; kill $BALLAST; exit 3; }
/bin/zsh "$HERE/../run-remote-page-smoke.sh" "$@"
STATUS=$?
kill $BALLAST 2>/dev/null
exit $STATUS
