# Smoke Gaussian Bead Pathology: Coverage Sweep

Question: Is the disqualifying bead stack intrinsic to freely positioned anisotropic Gaussian smoke, or does it arise because hard k-means partitions are projected with insufficient continuous support overlap?

Result: The bead stack is strongly mitigated by mass-preserving covariance dilation. Correcting the proxy to use the exact world-X/Y covariance marginal by itself did not remove the beads and slightly worsened image metrics. Sweeping explicit coverage scales from `1.0` through `3.0` selected `1.5` for nearly every frame/budget and `1.75` for sim-step 92 at 128 splats. The resulting render is continuous rather than beaded, with improved MSE and active-pixel IoU. It remains over-smooth and does not reproduce the teacher's internal smoke structure or upper-plume topology.

Structural model:

- The fitter uses density-weighted k-means with hard nearest-center assignments. Each Gaussian receives one partition's total extinction mass and within-partition covariance.
- At unit coverage, several kernels geometrically overlap, but one kernel dominates local optical depth. At sim-step 92 / 128 splats, the mean supported pixel sees `4.4822` kernels while the largest contribution averages `79.05%`; `25.24%` of supported pixels see only one kernel.
- Dilation preserves each Gaussian's integrated extinction while increasing bandwidth and reducing peak density. At selected coverage `1.75`, mean overlap rises to `9.1489`, mean peak dominance falls to `63.37%`, and the single-contributor fraction falls to `16.06%`.
- Kaminos's existing fire/smoke raster path independently uses explicit coverage factors around `1.7–1.8`, plus projected principal-axis covariance and an optical-depth ceiling. The selected oracle scale landing in that range explains why fire did not exhibit the same visible bead chain.

Route:

- repo/worktree: `/private/tmp/kaminos-smoke-oracle-ceiling-eater-live-0715`
- branch/source head before this slice: `cc/smoke-oracle-ceiling-eater-live-0715@bcb5829`
- renderer identity: `smoke-gaussian-oracle-render-witness-v1`
- projection authority: `exact-world-xy-covariance-line-integral-v0`
- compositor authority: `single-channel-smoke-luma-proxy-not-production-compositor-v0`
- camera authority: `orthographic-world-proxy-not-native-camera-v0`
- backend/device: CPU proxy rendering authoritative dense fields captured from `WebGPU:apple`
- budgets: `32,64,128`
- extinction scales: `0.00005,0.0001,0.0002,0.0004,0.0008,0.0016,0.0032`
- coverage scales: `1,1.25,1.5,1.75,2,2.5,3`; no hidden cap or substitution
- command template: `node smoke-gaussian-oracle-renderer.mjs --fit-report artifacts/smoke-gaussian-oracle-ceiling-0715/static-fit-v2-r64-temporal/sim-step-<STEP>/oracle-fit-report.json --raymarch-png artifacts/smoke-gaussian-oracle-ceiling-0715/teacher-sequence-v5-r64-c256k-threeframe/sim-step-<STEP>.raymarch.png --out-dir artifacts/smoke-gaussian-oracle-ceiling-0715/render-witness-v3-coverage-sweep-r64/sim-step-<STEP> --budgets 32,64,128 --extinction-scales 0.00005,0.0001,0.0002,0.0004,0.0008,0.0016,0.0032 --coverage-scales 1,1.25,1.5,1.75,2,2.5,3`

Images:

- `sim-step-92/orthographic-render-contact-sheet.png`: SHA-256 `25efe41e0b77c7b92efe514a52de58163460b45ebfb28e7c144f53dab8de8517`.
- `sim-step-93/orthographic-render-contact-sheet.png`: SHA-256 `7ee215e91ec8678390b7b508461d05bcfb1a2a089a98e95811b939c63d9dd7b8`.
- `sim-step-94/orthographic-render-contact-sheet.png`: SHA-256 `3fb523805d5d51d9be97ff77c069f795ba465da93eacc3c9e0a2db12a6521a13`.
- `kaminos-route-step-92.png`: visually inspected exact Kaminos operator route, `registered`, `609x753`, `7823` sampled nonblank pixels; SHA-256 `7c830e427d3d65ff685c3c8350d3fdd317ff4442b5292a8cf55d8cce946c74e2`.
- Baseline bead witness: `../render-witness-v1-r64/`.
- Full-covariance/no-dilation negative result: `../render-witness-v2-full-covariance-r64/`.

Does not prove: This is same-view scale selection through an orthographic single-channel proxy. It does not establish native-camera projection, production compositing, held-out-view fidelity, temporal recurrence, or a shipping coverage constant. It does establish that the original bead stack is structurally mitigable and therefore cannot honestly kill Gaussian smoke by itself.
