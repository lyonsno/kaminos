#!/bin/zsh
# Champion long-motion witness over the exact 30-state Grid96 corpus.
# Stage 1: champion ladder (hf-loss w4, N400, 2x budget) fits state-120 -> seat solution.
# Stage 2: chained damped+anchored witness across all 30 states from that seat.
set -e
ROOT=/private/tmp/kaminos-sjb-oracle-0807
PY=$ROOT/.venv/bin/python
MANIFEST=/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-grid96-exact-motion-62-120-r41/motion-manifest.json
SEAT_OUT=/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-sjb-longmotion-seat-r1
CHAIN_OUT=/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-sjb-longmotion-witness-r1
STATES="coefficient-state-120,coefficient-state-118,coefficient-state-116,coefficient-state-114,coefficient-state-112,coefficient-state-110,coefficient-state-108,coefficient-state-106,coefficient-state-104,coefficient-state-102,coefficient-state-100,coefficient-state-098,coefficient-state-096,coefficient-state-094,coefficient-state-092,coefficient-state-090,coefficient-state-088,coefficient-state-086,coefficient-state-084,coefficient-state-082,coefficient-state-080,coefficient-state-078,coefficient-state-076,coefficient-state-074,coefficient-state-072,coefficient-state-070,coefficient-state-068,coefficient-state-066,coefficient-state-064,coefficient-state-062"

cd $ROOT
echo "[stage1] champion seat fit @ state-120 (hf w4, N400, 2x budget)"
$PY -u volume-grid-progressive-ladder-oracle-mlx.py \
  --motion-manifest $MANIFEST --state-id coefficient-state-120 \
  --output-dir $SEAT_OUT --arms ladder \
  --mode-count 400 --high-frequency-weight 4.0 --stage-iterations 1000

echo "[stage2] 30-state damped+anchored chain from champion seat"
$PY -u volume-grid-chained-tracking-witness-mlx.py \
  --motion-manifest $MANIFEST \
  --source-solution $SEAT_OUT/oracle-n400-ladder-stage2-g32-s20260727-state.json \
  --chain-states "$STATES" \
  --mode-count 400 --hop-iterations 150 --high-frequency-weight 4.0 \
  --output-dir $CHAIN_OUT
echo "[done] witness at $CHAIN_OUT"
