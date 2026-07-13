# Aggressive rs010 residual sweep — same-state browser smoke

This folder preserves the first trustworthy same-state browser smoke after fixing `renderFrozenScaleToCanvas` to apply the browser direct residual pass.

Before the fix, the same-state witness could load a model and report residual telemetry while capturing byte-identical off pixels, because the frozen render path drew directly to the canvas and skipped `encodeBrowserResidualPass`. The fixed route mirrors live render: residual source pass into the frame/feature textures, residual pass into the current canvas texture, and explicit `residualApplied` plus cost telemetry in each capture report.

Verdict from this fixed support frame: existing latest-main direct-residual candidates are active but visually wrong for product. They add obvious flame-local bright speckle/block detail and suppress/darken smoke; all tested residual-on variants have higher mean absolute error to the native reference than the linear 0.10 baseline on this frame. Treat them as proof that the browser route and evidence path work, not as current winners.

Key files:

- `receipt.json` — route, pinned sim/render phase, model-load integrity, and capture list.
- `pixel_delta_summary.json` — per-candidate pixel deltas versus 0.10 off and 1.00 native reference.
- `index.html` — toggleable browser contact sheet for operator inspection.
- `delta-inspection/index.html` — crop-level visual delta sheet with amplified absolute and signed luma deltas.
- `00-rs010-linear-off.png` — low render-scale baseline.
- `99-rs100-native-reference.png` — same-state native reference.

Next training pressure:

- reduce broad luminance/chroma shove;
- reward gradient/shape agreement over raw RGB amplitude;
- add material-aware fire/smoke split supervision so smoke does not inherit fire brightness objectives;
- keep the direct one-pass route as the product-immediate target, with tiny-conv/hybrid as advisory teachers only if needed.
