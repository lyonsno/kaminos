# Exact Elbow 3D Packing V0

Question: Can the exact 35-degree analytical elbow become one shared
three-dimensional material domain in which two routed muscles and residual
tissue have exclusive ownership, rigid anatomy remains excluded, and a muscle
volume edit produces local displacement without re-identifying unaffected
material?

Result: Yes for this synthetic local domain. Baseline and edited cases each
contain 25,312 exclusively owned soft-tissue cells and 3,240 conservative
finite-cell rigid exclusions. Each admitted voxel's circumscribed volume clears
the joint, segment, and process primitives.
Increasing brachialis target volume by 18 percent transfers 268 cells from
residual tissue into brachialis. Every changed cell lies within the admitted
brachialis-local region; triceps count, rigid identity, attachment identity,
grid identity, and unchanged material coordinates remain stable. The transition
gate admits only `residual-tissue -> brachialis-like-flexor` for this edit.

Route:

- repo: `/Users/noahlyons/dev/kaminos`
- worktree: `/private/tmp/kaminos-molten-reciprocal-packing-0730`
- branch/head before result commit: `cc/molten-reciprocal-packing-0730@000f86f1`
- generation command: `node analytical-elbow-packing-witness.mjs artifacts/exact-elbow-packing-v0`
- visual admission command: `node analytical-elbow-packing-witness.mjs --admit-visual artifacts/exact-elbow-packing-v0 artifacts/exact-elbow-packing-v0/visual-admission-input.json`
- viewer: `http://127.0.0.1:8137/artifacts/exact-elbow-packing-v0/index.html`
- effective route: `exact-elbow-packing-orbitable-v0`
- browser backend: Google Chrome headless using ANGLE Metal
- desktop capture: Chrome headless screenshot at 1400 x 900 after a four-second virtual settle window
- mobile capture: Chrome DevTools Protocol device emulation at 390 x 844 followed by `Page.captureScreenshot`
- baseline control: exact analytical elbow at 35 degrees
- edited control: brachialis target volume multiplied by 1.18
- grid: `36 x 54 x 28`

Images:

- `witness-baseline-desktop.png`: baseline shared-domain projection at 1400 x 900.
- `witness-swell-desktop.png`: edited projection with changed ownership highlighted at 1400 x 900.
- `witness-swell-mobile.png`: edited narrow-viewport projection at 390 x 844.
- `visual-inspection.json`: effective route, exact HTML and pending-report
  bindings, viewport, screenshot hashes, backend identity, and inspection receipt.

Does not prove: anatomical correctness of the synthetic envelope, packing
through a pose sweep, generated-surface correspondence, production skinning,
finite-element behavior, or tissue-level constitutive mechanics.
