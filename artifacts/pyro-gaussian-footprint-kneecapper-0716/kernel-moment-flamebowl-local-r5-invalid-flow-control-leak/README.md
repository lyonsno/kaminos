# Rejected Flow Kernel Moment Covariance: Flamebowl Local R5

**Status: invalid false-closure receipt. Do not use the metrics below as a kernel-versus-world comparison.**

## Question

Does a view-independent covariance frame derived from Handy's frozen flow-kernel second moments improve the current world-gradient covariance baseline without changing candidate support, positions, appearance attributes, simulator state, source preset, or cameras?

## Result

Rejected. The kernel preflight set `flowKernelStrength=1`, and the witness failed to reset it when returning to analytic, learned, and world covariance. The supposed world baseline therefore consumed flow reconstruction after the kernel preflight. Independent GPT-5.5 review identified the missing preflight-to-admission predicate; repaired local r6 then failed on the analytic attribute hash mismatch and exposed this control leak.

The images remain useful only as evidence of the rejected path. They do not support a comparative performance claim.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-gaussian-footprint-kneecapper-0716`
- Captured working tree: renderer commit `97f496054fea1650040ea4c84331984a6cec62aa` plus the changes committed as `d2459f906855b86c04a3d37860ac7292b379a82c`
- Branch: `cc/pyro-gaussian-footprint-kneecapper-0716`
- Capture command:

```sh
node volume-raymarch-filament-orbit-witness.mjs \
  --url "$(jq -r .requestedUrl artifacts/pyro-gaussian-footprint-kneecapper-0716/kernel-moment-flamebowl-local-r5-invalid-flow-control-leak/report.json)" \
  --out-dir /tmp/kaminos-kernel-moment-flamebowl-preset-local-r5 \
  --orbit-angles=-0.42,-0.21,0,0.21,0.42 \
  --ray-steps=96,160 \
  --flow-kernel-strength=1 \
  --flow-kernel-radius=0.03 \
  --flow-kernel-coherence=1
```

- Requested/effective wrapper: `/volume-selective-head-live.html` / `exact-basin-selective-head-live-v0`
- Effective renderer/backend: `native-3d-compute-fluid-raymarch-v0` / `WebGPU:apple`
- Source: `big_raymarch_hero_flamebowl` / `vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2`
- Source authority: `shared-volume-settings-preset-v2`
- Frozen state: `filament-orbit-f103-s103`, controls SHA-256 `cade5c00c040b7dc3ede1037e6f81bc382fa5658d9787f56e1668b3e25175042`
- Candidate support: `80,011` Structural/Ridge-Owned rows, zero overflow, payload SHA-256 `7f30521294c43b9895837b77cc866f82914a723536cd9f11a7a2b466f0b35ab8`
- Resolution/steps: source grid `128`, render scale `0.296917052331791`, comparison captures at `160` ray steps
- Cameras: center camera `2` is training; cameras `0`, `1`, `3`, and `4` are held out
- Kernel controls: strength `1`, radius `0.03` world units, coherence `1`
- Model/checkpoint: no learned covariance model; deterministic analytic flow-kernel descriptor consumption
- Output completeness: `71` captures, exact frozen-repeat pixel match, all requested families/cameras present

## Images

- `camera-02-raymarch-160.png`: exact smoke-off Full Flame Intrinsic target.
- `camera-02-stateDerivedSupport-160.png`: target contribution allocated to current candidate support.
- `camera-02-worldCovariance-160.png`: current view-independent world-gradient covariance baseline.
- `camera-02-kernelMomentCovariance-160.png`: flow-kernel-moment covariance treatment.
- The same four roles are preserved for cameras `00`, `01`, `03`, and `04`.
- `index.html`: interactive camera comparison and held-out metric table.
- `camera-holdout-report.json`: validator-admitted metric and identity report.
- `report.json`: complete capture receipt, route identity, source identity, and false-closure checks.

Center-frame SHA-256:

| Image | SHA-256 |
| --- | --- |
| Full Flame target | `d72d9b8ad7b086a2b3c790eec2ca04f45309264c14e7db765da1aab2e969e3c2` |
| Support target | `ebc58bce88ffdccc5cff6f5e98d790edafb74412c67750bc03419b39a42e9b2d` |
| World covariance | `5d25f68b8ca60cdf8c97a1aae79ca963119a96ef8e4353eef46ff38be44e0d31` |
| Kernel-moment covariance | `7033c505c414f04027abaa43d52989d039bdb72aa3ff6c430c9f548399ca8cb4` |

## Does Not Prove

This run proves no kernel-versus-world quality result because the baseline treatment was contaminated by a leaked kernel reconstruction control. It remains preserved so the false-closure mechanism and rejected images cannot be mistaken for accepted evidence later.
