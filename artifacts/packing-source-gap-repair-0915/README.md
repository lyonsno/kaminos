# Contact-gap source repair: three authored-state exercises

The source repair keeps raw geometric signed gap negative for any measured penetration, including penetration below the admission tolerance. Admission tolerance, fixed attachments, original volume allowances, deformation basis, and nonlinear acceptance checks are unchanged. This removes fictitious clearance supplied to the optimizer; it does not turn the gap into a globally smooth signed-distance function.

## Outcomes

| Start | Pairwise penetration | Bone penetration | Outcome |
|---|---|---|---|
| Saved late boundary state | .0316155 → 0 | admitted 0 → 0; raw also ends 0 | One full inequality step clears measured contacts. Old step with the same repaired source ends at .0310251. |
| Earlier mild | 2.294736 → admitted 0 / raw 3.55e-14 | 2.053949 → 2.009537 | Three full steps; pair-only objective exhausted, bone remains. |
| Earlier severe | 9.514982 → 8.506026 | 6.162614 → 5.812467 | One accepted half-scale step; second attempt fails minimum-norm refinement. |

The earlier runs start from the original restoration-to-reference bridge with zero sine coefficients, not from the unmodified authored meshes. Both request eight steps but terminate earlier for the reasons above. Full saved states, every step's Jacobian/subproblem/candidates, effective configuration, source-file hashes, and result hashes are under `late/`, `mild/`, and `severe/`. No fallback solver is used.

The experimental objective minimizes pairwise overlap and prevents other admitted families from worsening. It does not actively minimize bone penetration or compact the arrangement. Raw relative volume error remains about 19.70% in late, 20.62% in mild, and 69.40% in severe; zero admitted volume residual means within the inherited allowance, not correct volume. Severe uses about 5e-7 additional relative-volume slack in its first step.

The severe second minimax stage succeeds with predicted worst pair residual7.003777 and norm2. Its secondary minimum-norm refinement returns `Inequality constraints incompatible` at iteration1. This is not proof the original packing is infeasible. Offline replay of its first-stage direction at scales1, .5, .25 gives actual pair residual9.740145,9.045561,8.698499, all worse than8.506026. However, scale.0625 gives8.438304 and passes the original family checks; scale.015625 also improves. Thus failed secondary refinement discards a useful smaller step. This diagnostic does not change the saved trajectory or prove further convergence. Full values and exact replay rule are in `severe-minimax-replay.json`.

## Views

`late-visual/`, `mild-visual/`, and `severe-visual/` hold orbitable HTML, exact display coordinates, and same-camera start/selected PNGs with browser receipts. The late view has old-step and source-repaired inequality choices. The earlier views compare only initialized start and actual selected solver output. Geometry is never displacement-amplified. Solid materials and camera are identical between states; no state-dependent wireframe trick.

Inspected at1400x1000: late geometry is visually near-identical; mild shows modest movement around the purple body's silhouette and neighboring cyan boundary; severe shows only small outline shifts and substantial projected overlap remains. These exterior views omit bone and overlap volumes, so they do not visually prove contact closure. Browser captures use software WebGL; they are not GPU performance evidence. Routes are explicit experimental views, not registered production workbench routes.

## Reproduction

Use the isolated Python environment recorded in each provenance file (SciPy1.18.1, NumPy2.5.3); no browser package dependency changed. Caller supplies output directory and interpreter. Long commands should use the workspace's registered job runner.

```sh
node tools/packing-inequality-comparison.mjs OUTPUT_DIR PYTHON
node tools/packing-inequality-trajectory.mjs OUTPUT_DIR PYTHON mild 8
node tools/packing-inequality-trajectory.mjs OUTPUT_DIR PYTHON severe 8
node tools/render-packing-inequality-comparison.mjs INPUT_DIR VIEW_DIR source-repair
node tools/render-packing-inequality-comparison.mjs INPUT_DIR VIEW_DIR trajectory
```

To replay the severe first-stage diagnostic, load `severe/problem.json` and `severe/step-002.json`; for scale1,.5,.25 pass `start.vector[j] + scale * solver.minimax.x[j]` to `evaluateAuthoredPackingExactResidualState`. The saved first-stage vector and unchanged evaluator are the replay authority.

Source fail-first test reproduced +.06494672686192171 versus required -4.495923633385246e-10 before repair. Source regression2/2, inequality7/7, trajectory failure1/1, view mapping1/1, focused preexisting admission1/1 passed. The broader exact-problem test passed; an old authored guard-exchange test failed because this same near-contact fixture was falsely classified as clear. It now asserts the existing contact enters the initial active set, preserving acceptance and accounting checks. Corrected authored test plus unchanged synthetic clear-row exchange tests pass3/3 (`guard-regression.tap`). New trajectory-tool preimplementation failure was missing-script, not a valid behavioral fail-first receipt; its postimplementation stale-success rejection is tested. Full repository suite was not run.
