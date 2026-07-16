# Promoted Crucible Bench Visual Diagnosis

Question: Does the promoted stone receiver, specimen tray, and Titan Hammer load as one truthful Crucible scene with AO disabled and remain visibly composed at desktop and narrow viewport sizes?

Result: The original 1600x1000 desktop frame is an agent-inspected known-good composition witness. The final 390x844 automated frame proves that aspect-aware camera framing includes the tray and Titan Hammer in the narrow canvas, but it is an observed-bad presentation frame because most sidebar controls intermittently painted black. On 2026-07-16, an exact-root desktop rerun reproduced the broader presentation-paint failure even though both automated pixel regions reported `ok: true`; that frame is preserved separately with top-level `status: failed-visual-inspection`. Automated composition capture is stopped for this slice.

Route:

- Repo: `/private/tmp/kaminos-wake-and-bake-pit-boss-0715`
- Branch/base: `cc/wake-and-bake-pit-boss-0715`, parent `4353ce27d222b914e275d638c38a192980085e75`; the composition delta is the commit containing this receipt.
- Current server-root-aware desktop command shape: `node crucible-asset-composition-witness.mjs --url http://127.0.0.1:8297/ --expected-server-root "$PWD" --out <output.png> --report <report.json> --cdp-port <free-port> --viewport-width 1600 --viewport-height 1000`. Do not execute again in this slice.
- Historical narrow command used port `8197` before server-root identity was required. It is retained in git history and must not be rerun.
- Requested/effective composition: `promoted-bench-2026-07-15` / `promoted-bench-2026-07-15`
- Registered objects: `stone-receiver`, `specimen-tray`, `titan-hammer`
- Backend/device: Chrome headless CDP, Kaminos Three.js/WebGPU scene route on the local Mac
- Model/checkpoint: none; this is deterministic local asset composition
- Render controls: AO disabled, Studio environment, desktop 1600x1000, narrow 390x844

Images:

- `crucible-promoted-bench.png`: previously reviewed known-good desktop composition, mechanically restored from Kaminos `649598f` after the 2026-07-16 failed rerun; SHA-256 `8d0bea9895850a4a35fa27e060a15b0f6ac310f3a2c3cc914ef164a2ce096c94`.
- `crucible-promoted-bench-desktop-control-paint-failure-2026-07-16.png`: observed-bad exact-root desktop frame whose controls, tray, and hammer painted black despite nominal pixel passes; SHA-256 `55be42572d15701731edf116b59d50a76a385503a28038e9aaa9a5eee8d66fe6`.
- `crucible-promoted-bench-mobile.png`: observed-bad narrow presentation frame with correctly framed 3D content and intermittent black sidebar paint; SHA-256 `9ae34ba449142766c2ba9c71c4837c02f3beae523d4442c6c7460d01a46194dc`.
- `crucible-promoted-bench-witness.json`: passing requested/effective identity, three-object registration, AO, and canvas-pixel receipt for the desktop frame.
- `crucible-promoted-bench-desktop-control-paint-failure-2026-07-16-witness.json`: failed visual receipt preserving exact expected/effective server root and the false-positive automated pixel disposition.
- `crucible-promoted-bench-mobile-witness.json`: failed visual receipt that retains the nominal canvas-only pass as subordinate telemetry.

Run chronology: the first narrow run failed with a 10 px canvas under the legacy fixed sidebar. The second run proved the responsive canvas but cropped the composition. The third run applied aspect-aware framing and produced the observed-bad black-control frame preserved here. Earlier narrow screenshots were overwritten by the initial witness output path before this evidence directory was brought under the durable protocol; that overwrite is not evidence of their visual contents. On 2026-07-16, the operator's handed-off `8197` route returned a 59-byte recovery page from another lane, exposing that HTTP 200 did not prove effective server identity. Wake started canonical `serve.py` on `8297`, verified `/api/roots` and byte-identical `index.html`, then performed one desktop rerun with explicit expected-root identity. The exact-root route loaded and registered correctly, but the captured presentation again painted mostly black while automated pixel checks passed. That frame was visually failed and automated reruns stopped.

Does not prove: clean narrow-viewport control paint, Titan Hammer topology or collision, specimen slot interaction, receiver-mask authority from the visual GLB, surface-board integration, or flame smoothness. Receiver truth remains in `promoted/receiver-descriptor.json` and the receiver proxy. The known Titan handle winding defect remains accepted only with AO disabled.
