# Same-state inequality-step comparison, September 15

This is experimental evidence, not a production solver replacement. The existing authored six-body late-stage geometry is recovered from `artifacts/authored-packing-exact-repeated-convergence-v0/index.html` as coefficients in the canonical18-DOF sine basis (maximum coordinate error7.16e-15). The original geometry evaluator, endpoint masks, compartment, volume allowance, and radius2 are shared by both runs.

`raw-r2/` preserves unmodified completed run output. Initial maximum pair penetration .031615494722519344; incumbent one step .031025096029782873; uncorrected inequality step .03161549425141885 (effectively no movement). A proposed full inequality step nearly resolves pair contact but enters the bone .0216627388. Existing nonlinear rejection is correct.

`raw-r2/gap-probe.json` is an intercept-only counterfactual: bone/muscle-2 exposes positive gap .06494672686192171 despite raw penetration4.495923633385246e-10. Replacing only that local linear intercept with negative raw penetration, preserving the measured Jacobian and other subproblem inputs, yields raw/admitted pair and bone zero under independent replay of the unchanged nonlinear evaluator. Endpoint, compartment, and admitted volume residuals stay zero. Raw volume debt remains .1970001222577586. Largest node displacement .0491947410. This is contact cleanup on a late-stage state, not proof of compact packing or full-path convergence.

The raw comparison ran before reporting-validation repairs: `raw-r2/result.json` lacks a baseline evaluation count, recoverable as136 from `baseline.json.work.evaluationCount` (candidate68). Final runner now validates complete candidate rows/nonnegative physical metrics, invalidates stale result at invocation, writes terminal failure on error, and binds completed artifacts by hashes. Raw r2 is retained rather than silently relabeled as final-code execution. `r1-failure.json` records the initial unsuccessful reconstruction route. Independent review replayed the actual successful diagnostic geometry and verified its carrier hash.

## Reproduce

From this branch, create an isolated environment (no browser dependency change):

```sh
uv venv --python 3.12 .venv-packing
uv pip install --python .venv-packing/bin/python numpy==2.5.3 scipy==1.18.1
PACKER_SCIPY_PYTHON="$PWD/.venv-packing/bin/python" node --test tests/packing-inequality-step-contracts.mjs
node tools/packing-inequality-comparison.mjs /private/tmp/packing-new-comparison "$PWD/.venv-packing/bin/python"
node tools/packing-inequality-gap-probe.mjs /private/tmp/packing-new-comparison /private/tmp/packing-new-comparison/gap-probe.json "$PWD/.venv-packing/bin/python"
node tools/render-packing-inequality-comparison.mjs /private/tmp/packing-new-comparison /private/tmp/packing-new-comparison/visual
```

Run longer comparisons through the repository's registered-completion workflow. Use a caller-owned output directory. The comparison is two lexicographic SLSQP subproblems: minimum predicted worst pair violation, then minimum displacement at that value. It retains the original nonlinear veto and is not a global nonlinear optimizer.

## Visual evidence

`visual/index.html` offers four actual-scale states with identical materials/camera. Start and corrected frames were rendered and inspected: no meaningful full-assembly silhouette change is visible at this scale. The renderer shows six cage surfaces, not the central bone or intersection-volume geometry; contact clearance here is numerical evidence, not visually established by these frames. The original source is not one of the four states, avoiding confusion with initialization. Capture receipts bind actual rendered state/carrier and record software WebGL fallback; they are not native-GPU performance evidence.

Serve this Kaminos worktree with `python3 serve.py 8793`, then open `/artifacts/packing-inequality-comparison-0915/visual/index.html`. Current experimental route `experimental-packing-inequality-comparison-v0`; not registered in the general main workbench. No production or main landing was performed.
