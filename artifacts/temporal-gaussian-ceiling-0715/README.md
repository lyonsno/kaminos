# Temporal Gaussian Smoke Ceiling, Experiment 1

## Verdict

**Pass: sparse multiscale Gaussian smoke is a credible production research vein.** On the accepted narrow-source `operator_fire_0622` teacher, independently fitted Gaussians preserve broad plume topology across three adjacent frames and three hostile cameras without support leakage or view collapse. A 1,024-splat budget already carries most of the visible silhouette; 8,192 and 16,384 splats improve boundary agreement but do not restore the teacher's articulated interior. The remaining wall is therefore structure allocation, temporal identity, and the extinction/radiance model, not raw splat count.

This result advances the phase-offset neural decoder experiment. It does not justify broad optimization of the hybrid flame-splat/smoke-raymarch path yet. The raymarch remains the authoritative teacher and fallback.

## Question

Can a sparse anisotropic Gaussian representation retain coherent, articulated smoke over time and across hostile views at a budget that is plausible for many instanced flames?

## Source Authority

- Repo: `kaminos`
- Worktree: `/private/tmp/kaminos-handy-smoke-temporal-ceiling-0715`
- Branch/base head: `cc/handy-smoke-temporal-ceiling-0715` at `2245438cb5375f542d12ae0f1b397a9f8b391b05` before this receipt
- Teacher identity: `operator-fire-0622-r160-paired-source-temporal-teacher-v0`
- Effective renderer route: `native-3d-compute-fluid-raymarch-v0`
- Prototype/backend: `kaminos-volume-prototype-v0`, `WebGPU:apple`
- Source controls: `tall_plume`, preset `operator_fire_0622`, input radius `0.12`, flow rate `0.35`, resolution `160`, majorant grid `24`
- Render controls: scale `0.35`, 64 ray steps, temporal accumulation off, jitter off, history clamp `1`
- Capture authority: `capture-hold-explicit-step-v0`
- Presentation barrier: `gpu-queue-complete-before-cdp-capture-v0`
- Camera authority: `checksum-bound-native-camera-matrices-v0`
- Fitter: `recursive-gradient-moment-split`, structure gradient gain `4`
- Static budgets: exact uncapped `512,1024,2048,4096,8192,16384`
- Temporal analyzer: `smoke-gaussian-oracle-temporal-correspondence-v0`
- Smoke support admission: visual candidate at simulation step 45, `55,194` smoke-like pixels, vertical fill `0.55833`, lateral fill `0.16556`, adjacent-pixel evolution `3.1567%`, authority `render-bounds-only-v0`; the candidate required and received original-resolution visual disposition.

The complete machine receipts remain under this directory. The three full-grid fluid sidecars are intentionally not part of the durable Git evidence because they total roughly 750 MB; their checksum-bound identities remain in the manifests and reports.

### Review Correction

Independent review identified that the first capture path submitted the native raymarch and immediately requested a CDP screenshot without a positive GPU-completion witness. Revision one added `device.queue.onSubmittedWorkDone()` after the explicit submission, made the capture CLI reject a missing or substituted barrier, and persisted the effective barrier in every frame and sequence receipt. The corrected capture is `accepted-source-r160-teacher-v9-barrier-receipt-m24/teacher-capture-report.json`.

The v9 rerun reproduced the pre-review step 45–47 fluid identities, manifest identities, decoded image hashes, and native screenshot hashes exactly. The existing static fits and contact sheets therefore remain checksum-bound to the corrected deterministic source rather than merely looking similar. Original-resolution inspection of the v9 frames confirmed the same narrow, source-attached plume with subtle advancing head and side-contour motion; it did not reveal a stale, blank, or partially presented frame.

## Static And Temporal Results

Every fit represented the teacher's total extinction to floating-point tolerance and reported zero support leakage.

| Budget | Minimum matched | Worst births/deaths | Worst mean motion | Worst p95 motion | Worst extinction drift |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 512 | 501 / 512 | 11 | 0.02253 | 0.05450 | 2.8288% |
| 1,024 | 985 / 1,024 | 39 | 0.02017 | 0.04554 | 2.8288% |
| 2,048 | 1,970 / 2,048 | 78 | 0.01787 | 0.04140 | 2.8288% |
| 4,096 | 3,969 / 4,096 | 127 | 0.01590 | 0.03974 | 2.8288% |
| 8,192 | 7,971 / 8,192 | 221 | 0.01385 | 0.03567 | 2.8288% |
| 16,384 | 15,999 / 16,384 | 385 | 0.01130 | 0.02895 | 2.8288% |

The extinction drift is present in the teacher sequence rather than introduced by the Gaussian fit. Split/merge counts are neighborhood-risk diagnostics over independently repartitioned fits; they are not claimed as literal tracked topology events.

At the native camera, support IoU increased from `0.91571` at 1,024 splats to `0.95105` at 16,384. Luma MSE did not improve (`0.00049636` to `0.00051851`), matching the visual result: more splats sharpen the support boundary but leave the smooth/banded interior error intact. Adjacent-frame 1,024-splat IoU remained `0.91204` and `0.91659`; 8,192-splat IoU remained `0.94740` and `0.94923`, with no visually observed popping.

## Hostile Views

| Camera | 1,024 IoU | 8,192 IoU | Visual disposition |
| --- | ---: | ---: | --- |
| side +90 | 0.77394 | 0.82579 | Hardest view; silhouette survives, horizontal bands and contour error remain. |
| back +180 | 0.91800 | 0.91883 | Strongest view; extra budget changes little. |
| elevated +35 | 0.83461 | 0.85586 | Broad shape survives; internal structure is smoothed. |

The dense hostile-view teachers have low optical-depth maxima (`0.057` to `0.086`), so their linear grayscale contact sheets are dark. They remain useful for shape and route comparison, not appearance judgment.

## Inspected Images

Each contact sheet contains the raymarched teacher, Gaussian proxy, and absolute luma difference. These are CPU single-channel optical proxies, not the production HDR compositor.

- `render-gradient4/sim-step-45-final/perspective-render-contact-sheet.png` (`sha256:0a4d2dee075e165006708ffe2726711277214da03f8aa73435bc5703b1c70b72`): native-camera 1K/4K/8K/16K ceiling.
- `render-gradient4/sim-step-46-temporal/perspective-render-contact-sheet.png` (`sha256:175a773e1dd6003026afd2204ed7eb3218d0d3f2873d5aa4febe0094e43e0d7f`): adjacent frame 46 at 1K/8K.
- `render-gradient4/sim-step-47-temporal/perspective-render-contact-sheet.png` (`sha256:e1b89fe3f339990db15e82bd72dd694947131ba568f7d39b7ce3a791874201dc`): adjacent frame 47 at 1K/8K.
- `hostile-gradient4/sim-step-45/side-plus-90/gaussian-render-final/perspective-render-contact-sheet.png` (`sha256:4a23dc9bba74b0acaa70886fd9e779e596aeabc2cfc19059aef3d046362b50e9`): weakest hostile view.
- `hostile-gradient4/sim-step-45/back-plus-180/gaussian-render-final/perspective-render-contact-sheet.png` (`sha256:233c7799bcaaac758e77e98db49d5207de59047ff95d4f8dde0457f88761d280`): strongest hostile view.
- `hostile-gradient4/sim-step-45/elevated-plus-35/gaussian-render-final/perspective-render-contact-sheet.png` (`sha256:d2d43ced50d68c61fab9cf60f140109c04466257814aabce49388fee7d3cc411`): elevated hostile view.

## Reproduction

Teacher capture uses the post-barrier route recorded in `accepted-source-r160-teacher-v9-barrier-receipt-m24/teacher-capture-report.json`. Static fits use:

```sh
node smoke-gaussian-oracle-fitter.mjs --manifest <sim-step-N.manifest.json> --out-dir <fit-dir> --budgets 512,1024,2048,4096,8192,16384 --structure-gradient-gain 4
```

Temporal analysis uses:

```sh
node smoke-gaussian-oracle-temporal.mjs --fit-reports <step-45-report>,<step-46-report>,<step-47-report> --out-dir artifacts/temporal-gaussian-ceiling-0715/temporal-gradient4 --budgets 512,1024,2048,4096,8192,16384 --max-match-distance-multiplier 2.5
```

Hostile-camera authority and render settings are recorded in `hostile-gradient4/sim-step-45/hostile-camera-split-report.json` and each nested `render-witness-report.json`.

## Does Not Prove

- This is one accepted narrow-source plume, three adjacent frames, and three hostile cameras; it is not broad source-family generalization.
- Independent fits provide correspondence evidence but do not solve persistent learned Gaussian identities through topology changes.
- The proxy has one smoke-luma channel and does not prove production extinction, scattering, self-shadowing, scene lighting, or flame/smoke depth compositing.
- No phase-offset instancing was exercised. Experiment 2 must determine whether one neural decode can produce independently phased smoke instances without synchronized clones, frozen upper volumes, or budget multiplication.

## Next Gate

Run the phase-offset neural decoder transfer at a deliberately low budget frontier: begin at 1,024 splats per source, compare shared-decode phase offsets against independently advanced teacher frames, and require temporal desynchronization, source attachment, hostile-view integrity, and explicit decoder/runtime timing. Escalate splat count only if a named error improves; do not use count as the default response to missing internal articulation.
