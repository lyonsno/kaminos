# Severe packing: primary-proposal recovery

The optional minimum-movement refinement no longer discards a validated primary minimax proposal. Primary optimizer success, finite coordinates, linear constraints, trust radius and bounds are checked first. A valid refinement remains preferred; failed/invalid refinement is explicitly recorded while the valid primary reaches the unchanged nonlinear backtracking/acceptance checks. Failed primary optimization is not salvaged. Nonfinite optional diagnostics remain explicit JSON-safe strings, not a reason to lose a valid numeric proposal.

## Outcome

Same severe initialized authored start, same18 sine degrees of freedom, same radius2, finite difference.001, bounds and backtracking scales, same pair objective and other-family nonworsening checks. Eight steps requested and all eight accepted in498.013seconds /545 geometry evaluations. Valid primary reuse occurred at steps2 and4; refinement succeeded at the other six.

| State | Maximum muscle-pair penetration | Maximum bone penetration |
| --- | --- | --- |
| Initialized severe start | 9.5149820048862 | 6.1626139143582055 |
| Previous stop after one step | 8.506025809610756 | 5.812467441841391 |
| After eight steps with recovery | 8.412153173199302 | 5.807935663586861 |

The repair buys seven additional accepted steps and1.1036% further pair-residual reduction relative to the previous stop. It does not establish strong convergence or packed anatomy. Extra maximum node movement relative to previous stop is.1343379457 model units; relative to initialized start,.7156799006. Fixed endpoints and compartment escape remain zero. Raw relative volume error remains about69.399%; admitted volume error zero is inherited allowance, not restored volume.

Actual1400x1000 browser frames were inspected for start/previous/selected. Previous versus recovered endpoint has no conspicuous whole-object silhouette change; differences are slight edge/facet shifts. Solid materials, framing and scale are identical; no amplified displacement. Bone and overlap volumes are omitted and disclosed. Browser witness uses software WebGL, not native-GPU performance evidence. View is an explicit experimental route, not a production workbench registration:

`http://localhost:8793/artifacts/packing-refinement-recovery-0915/visual/index.html`

Buttons distinguish initialized authored start, previous stopped result, and result after refinement recovery. Previous state is copied byte-for-byte from `../packing-source-gap-repair-0915/severe/selected.json`.

## What still limits progress

The solver still minimizes muscle-pair penetration while bone penetration is only a nonworsening guard. Many large proposals actually worsen muscle contact despite predicted improvement. Separately, step5 scale.5 reduces pair residual8.42435923→8.24981204 but rejects solely for skeletal increase3.19336e-11 against the existing1e-12 threshold. Step8 scale.5 similarly reaches8.23900089 but rejects solely for skeletal increase2.28777e-11. These are actual saved candidate measurements, not hypothetical gains or accepted states. Their volumes remain admitted. Distinguishing genuine tiny motion from numerical calculation error and reconciling subproblem feasibility tolerances with nonlinear admission is a concrete next diagnosis; this slice changes no tolerance. These observations do not prove that simply loosening the guard produces good convergence. Joint bone restoration and compactness/volume objectives remain separate work.

## Source and replay boundary

The original run spans a diagnostic-only Python revision: strict-JSON nonfinite receipt handling was repaired while the long run was executing. Startup provenance remains untouched and records source hash1b8f3e37; the exact reconstructed source snapshot `subproblem-at-start.py.txt` matches it. Final source is separately preserved in `subproblem-final.py.txt` at b7a6ce7d. Exact load times per step were not recorded; do not attribute all original execution to the final hash.

`verify.mjs` replays all eight saved subproblems through final Python and requires exact direction, source, refinement-status and solve-status agreement. It independently reevaluates all selected states using unchanged geometry, checks accepted improvement and family guards, links consecutive vectors, verifies original artifact hashes, and checks initialized state equals the prior severe run. `verification.json` passes8/8. This establishes final-solver reproduction of recorded proposals and geometry, not retroactive uniform source identity. `partial-run-rejection.json` preserves a negative probe: the same verifier rejects an in-progress run before treating it as terminal evidence. All raw step outputs/candidates remain under `severe/`; no failed-refinement evidence was pruned.

## Reproduce

Use the recorded isolated environment (SciPy1.18.1). The original run used detached supervision and exited0; numerical termination is step-budget-exhausted, not convergence. No new hidden budget or timeout. Run identity and effective configuration are preserved in `severe/provenance.json`.

```sh
.venv-packing/bin/python tests/packing-inequality-subproblem-contracts.py
PACKER_SCIPY_PYTHON=.venv-packing/bin/python node --test tests/packing-inequality-step-contracts.mjs tests/packing-inequality-trajectory-contracts.mjs tests/packing-inequality-view-contracts.mjs
node tools/packing-inequality-trajectory.mjs OUTPUT_DIR PYTHON severe 8
node artifacts/packing-refinement-recovery-0915/verify.mjs artifacts/packing-refinement-recovery-0915/severe OUTPUT_REPORT
node tools/render-packing-inequality-comparison.mjs artifacts/packing-refinement-recovery-0915/severe VIEW_DIR refinement-recovery
```

Python7/7; JS10/10 after added view mapping. Source-selection tests failed on prior behavior for retained-primary status and validation; saved severe backend case also failed. New view mapping failed on unsupported explicit mode before implementation. Independent review caught the nonfinite receipt issue, reproduced it before repair and confirmed the actual CLI regression afterward. Test logs are retained here. Full repo suite not run. Feature branch only; no main or production adoption.
