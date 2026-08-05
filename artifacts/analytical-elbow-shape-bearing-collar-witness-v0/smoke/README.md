# Exact Collar Failure Witness Evidence

Question: Can the reviewed graded surface-collar control failure be made spatially legible without adding motion or implying that a corrective cage has already been implemented?

Result: Yes. The profile comparison localizes the hard split's inverted wedge and shows the widest collar distributing strain through a broad bend. The three-quarter rest-overlay comparison makes displaced volume legible. The responsive browser witness has no horizontal overflow or toolbar overlap, and all four canvases contain non-background geometry pixels.

Route:
- repo: `lyonsno/kaminos`
- worktree: `/private/tmp/kaminos-mushfinger-shape-bearing-collar-assay-0804`
- branch: `cc/mushfinger-shape-bearing-collar-assay-0804`
- implementation commit: `0ec784520131ce953fe51390f5ecf46158b23f2e`
- generator: `node analytical-elbow-collar-witness.mjs artifacts/analytical-elbow-shape-bearing-collar-witness-v0`
- server: `python3 -m http.server 4178 --bind 127.0.0.1`
- page: `http://127.0.0.1:4178/artifacts/analytical-elbow-shape-bearing-collar-witness-v0/index.html`
- alternate page: `http://127.0.0.1:4178/artifacts/analytical-elbow-shape-bearing-collar-witness-v0/index.html?camera=three-quarter&wire=1&rest=1`
- backend/device: Chrome headless CDP, WebGL through ANGLE Metal; exact browser version is in `browser-smoke-receipt.json`
- source: `synthetic-mammalian-elbow-v0` through effective `analytical-cage`
- witness route: requested and effective `analytical-elbow-collar-failure-witness`, no fallback

Images:
- `desktop-cdp.png`: profile control comparison at 1440 by 1100 CSS pixels.
- `desktop-three-quarter-wire-rest-cdp.png`: three-quarter comparison with posed wireframe and undeformed rest wireframe.
- `mobile-full-cdp.png`: full-page responsive comparison at 390 by 844 viewport CSS pixels.

Hashes:
- `desktop-cdp.png`: `cfba49ebde6333b89a31b42bb7a7dd8bee32834934277c45bac7d50483e4bb0b`
- `desktop-three-quarter-wire-rest-cdp.png`: `87850799a077cc8202f8e67a8a123d9a321984130cdfd22561d37d4533c9c09e`
- `mobile-full-cdp.png`: `85cad5409b7f69d4890024cc40b6e5282e546dd3f4c9c0c69e8a6187e768587b`

Does not prove: creature-level poseability, anatomical correctness, production deformation quality, or that the selected volumetric/corrective freedom succeeds. This visualizes only the exact synthetic sleeve control and the reason that control was rejected.
