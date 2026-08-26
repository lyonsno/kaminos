# Repeated exact-authored six-body descent witness

Question: Does the reviewed exact tetrahedral residual carrier produce a visually meaningful packing change across its first eight accepted global active-row/trust-region steps, while preserving the authenticated start and hard constraints?

Result: The exact trajectory is lawful and strictly descending, but it does not produce operator-visible packing motion after eight accepted steps. The solid start and selected frames are visually indistinguishable from the default camera. The largest boundary-node displacement is `0.0020580307` across a `237.3552438`-unit assembly diagonal (`8.67e-6` of the assembly scale, approximately `0.01` pixel at the captured framing). The overlap-volume frames preserve the same three pair-contact families with a slightly reduced maximum penetration. The selected motion-ghost frame superimposes nearly coincident surfaces and must not be interpreted as visually legible displacement. This evidence supports lawful local residual descent only; it does not support visible packing progress, convergence, or contact closure.

Route:

- repo: `/private/tmp/kaminos-packer-authority-carrier-0824`
- worktree: `/private/tmp/kaminos-packer-authority-carrier-0824`
- branch/head: `cc/packer-authority-carrier-0824@ab0942f0ee7434a79f55b857a76b4f957d6d9209`
- generation command: `node /private/tmp/packer-exact-authored-repeated-convergence-0825-r2/generate-viewer.mjs`
- capture command: `node /private/tmp/packer-exact-authored-repeated-convergence-0825-r2/capture-viewer.mjs`
- server command: `python3 serve.py 8798`
- requested/effective visual route: `authored-packing-exact-residual-trajectory-orbitable-v0`
- requested/effective capture route: `independent-headless-same-page-screenshot-v1`
- source result: `/private/tmp/packer-exact-authored-repeated-convergence-0825-r2/result.json` (`e6b2e8fac52dcf00bcc765a53b45a68f71ae8b56e1e394560fa2175cff754a51`)
- independent verification: `/private/tmp/packer-exact-authored-repeated-convergence-0825-r2/verification.json` (`e971d5f6b2817e32a8763a2284a2dc9ab5a007d3d3b909bb90038e8c74a5a43d`)
- visual bundle: `cd5fc2790069b96c541af3c13e40f45a321e1f2521e1b2de9f227691083189c3`
- capture batch: `0cac948e470d1d4f3ce53561b8cb006e4999c99ab49d5491f90acbd9d8f1963f`
- viewport: `1800x1200`, same deterministic initial camera for every frame
- backend/device: Google Chrome headless WebGL through the receipt-bearing same-page capture route on `MacBook-Pro-2.local`
- captured: `2026-08-25T20:20:46-0400`

Images:

- `start-solid.png`: authenticated global-search start with solid surfaces.
- `selected-solid.png`: selected carrier after eight accepted global steps with the identical camera and material state.
- `start-overlaps.png`: start with exact intersecting tetrahedral-cell volumes highlighted.
- `selected-overlaps.png`: selected carrier with exact intersecting volumes highlighted; the same three pair-contact families remain.
- `selected-motion-ghost.png`: selected carrier with the global-search start ghosted. The surfaces are too nearly coincident to expose displacement at this framing; the frame verifies overlay/state binding, not visually meaningful motion.

Receipts:

- `viewer-report.json`: source, bundle, route, registration, and HTML identity.
- `capture-batch-report.json`: declared semantic views, per-image SHA-256 hashes, effective browser route, and DOM frame receipts.
- `*-capture-report.json`: raw receipt-bearing browser evidence for each frame.

Does not prove: convergence, contact-free packing, cycle freedom beyond eight accepted steps, severe-pathology repair, anatomical correctness, production behavior, broad input coverage, sculpt-workflow admission, or superiority of this representation and search law over the remaining architecture challengers.
