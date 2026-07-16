# Promoted Crucible Bench Visual Diagnosis

Question: Does the promoted stone receiver, specimen tray, and Titan Hammer load as one truthful Crucible scene with AO disabled and remain visibly composed at desktop and narrow viewport sizes?

Result: The 1600x1000 desktop frame is an agent-inspected known-good composition witness. The final 390x844 automated frame proves that aspect-aware camera framing includes the tray and Titan Hammer in the narrow canvas, but it is an observed-bad presentation frame because most sidebar controls intermittently painted black. Its witness report preserves `automatedStatus: passed` for the canvas-only result while top-level `status: failed-visual-inspection` records the authoritative visual disposition. Do not rerun the same automated narrow capture in this slice.

Route:

- Repo: `/private/tmp/kaminos-wake-and-bake-pit-boss-0715`
- Branch/base: `cc/wake-and-bake-pit-boss-0715`, parent `4353ce27d222b914e275d638c38a192980085e75`; the composition delta is the commit containing this receipt.
- Desktop command: `node crucible-asset-composition-witness.mjs --url http://127.0.0.1:8197/ --out artifacts/crucible-composition-smoke-2026-07-15/crucible-promoted-bench.png --report artifacts/crucible-composition-smoke-2026-07-15/crucible-promoted-bench-witness.json --cdp-port 9364 --viewport-width 1600 --viewport-height 1000`
- Narrow command: `node crucible-asset-composition-witness.mjs --url http://127.0.0.1:8197/ --out artifacts/crucible-composition-smoke-2026-07-15/crucible-promoted-bench-mobile.png --report artifacts/crucible-composition-smoke-2026-07-15/crucible-promoted-bench-mobile-witness.json --cdp-port 9365 --viewport-width 390 --viewport-height 844`
- Requested/effective composition: `promoted-bench-2026-07-15` / `promoted-bench-2026-07-15`
- Registered objects: `stone-receiver`, `specimen-tray`, `titan-hammer`
- Backend/device: Chrome headless CDP, Kaminos Three.js/WebGPU scene route on the local Mac
- Model/checkpoint: none; this is deterministic local asset composition
- Render controls: AO disabled, Studio environment, desktop 1600x1000, narrow 390x844

Images:

- `crucible-promoted-bench.png`: known-good desktop composition; SHA-256 `11ca2a8c71cda3c265b76af523deb248753eada548d26b03d800bb380cdecce6`.
- `crucible-promoted-bench-mobile.png`: observed-bad narrow presentation frame with correctly framed 3D content and intermittent black sidebar paint; SHA-256 `9ae34ba449142766c2ba9c71c4837c02f3beae523d4442c6c7460d01a46194dc`.
- `crucible-promoted-bench-witness.json`: passing requested/effective identity, three-object registration, AO, and canvas-pixel receipt for the desktop frame.
- `crucible-promoted-bench-mobile-witness.json`: failed visual receipt that retains the nominal canvas-only pass as subordinate telemetry.

Run chronology: the first narrow run failed with a 10 px canvas under the legacy fixed sidebar. The second run proved the responsive canvas but cropped the composition. The third run applied aspect-aware framing and produced the observed-bad black-control frame preserved here. Earlier narrow screenshots were overwritten by the initial witness output path before this evidence directory was brought under the durable protocol; that overwrite is not evidence of their visual contents.

Does not prove: clean narrow-viewport control paint, Titan Hammer topology or collision, specimen slot interaction, receiver-mask authority from the visual GLB, surface-board integration, or flame smoothness. Receiver truth remains in `promoted/receiver-descriptor.json` and the receiver proxy. The known Titan handle winding defect remains accepted only with AO disabled.
