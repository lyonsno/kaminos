# Gravity Collapse Development Evidence

This is an incomplete CPU bonded-block experiment, not a successful whole-arch collapse handoff. The previous structural-volume comparison remains unchanged.

- `assay-r1.json.gz`: raw first comparison using an explicit hand spring. Strengths 80 and 160 become numerically unstable after separation; their dramatic motion is rejected. The strength-120 case alone cannot establish a robust collapse route.
- `assay-r2.json.gz`: raw comparison after moving the grip into the engine's soft point constraint. All three intact controls remain connected; all three injured cases lose four connections and one dynamic block. No post-release crack propagation or whole-arch collapse is established. The same 60 recorded front-only target movements are preserved for replay.
- `browser-r1.json` and `browser-r2.json`: terminal failures, source hashes, independent executable identity, input commands, exception detail, and standing frames. Both fail at the same pointer-selection predicate because a Three.js vector was passed to a Cannon coordinate-conversion method. The ray actually hit the correct front block. The source conversion is corrected after R2, but no third browser execution has yet verified it.

The assay reports are gzip-compressed losslessly for transport; `gzip -dc assay-r2.json.gz` reconstructs the exact recorded JSON. Original uncompressed files remain in the development worktree. Reports marked `complete` mean that the command reached its terminal phase, not that collapse acceptance passed. Source hashes, effective configuration, target identity, input sequence, full body states, connection state, event history, and step timings are retained.

Commands are recorded in each JSON. Interactive source: `structural-material-arch-collapse.html`; CPU experiment core: `structural-material-arch-collapse.js`; deterministic contracts: `tests/structural-material-arch-collapse-contracts.mjs`. The visible standing frames were inspected, but no falling, rest, mobile, or Bind frame has passed this browser witness. Ordinary independent review remains pending until the implementation achieves its intended behavior.
