# Explicit Non-Ridge Support Assay

## Verdict

The smallest high-recall deterministic selector found on the corrected randomized corpus is:

```text
step(1e-6, boundary.gradientGain)
  * clamp((1.25*fire.energy + 0.52*fire.emission + 0.86*fire.detail
           + 0.72*micro.z + 0.24*material.heat) / 1.5, 0, 1)
```

The selected threshold is `0.00784313725490196`. This selector uses source-complete simulator fields plus the authored boundary permission control. It does not consume membership or optical targets at inference time.

On held-out `setting-p`, it admits 808,609 of 809,138 exact hard-positive cells: 99.9346% hard-positive recall, 83.9481% precision, 12.0230% false-positive rate, and 0.91246 F1. On calibration `setting-q`, it reaches 94.0862% hard-positive recall, 90.4297% precision, and 7.8773% false-positive rate.

The sole exact-black control, `setting-d`, contains 894,852 populated source-fire cells. The selector admits zero of its 2,097,152 cells. The previous source-only winner admitted 964,151 black-control cells, or 45.9743% of that grid. Authored control identity is therefore a necessary discriminator on this corpus.

## Companion Rule

The assay also reconstructs the authored boundary carrier from thermal, reaction, front, interface, velocity, curl, divergence, world-space neighborhood gradients, and eleven authored controls. That narrower rule is the precision-biased companion: on held `setting-p` it produced 65.4822% hard-positive recall, 95.2524% precision, and 2.0546% false-positive rate, while also admitting zero black-control cells.

The two rules expose an actionable transport tradeoff:

- `authored.gradient-gated-fire.signal` is the broad high-recall Non-Ridge support layer.
- `authored.boundary.raw` is the narrower high-confidence boundary layer.
- Ridge and Non-Ridge remain separate coefficient layers under one transport: `sigma_total = sigma_ridge + sigma_nonridge`.

## Authority Limit

This is source-closure evidence over 17 whole effective-control settings and 35,651,584 uncapped cells. It is not a universal proof that `boundary.gradientGain` is the only authored permission control. The corrected corpus contains one exact-black setting, and that setting is the only setting with zero gradient gain. Promotion beyond this assay should retain a black-control veto and acquire additional independently authored zero-support controls.

No renderer, UI, appearance model, or independent image layer was changed. No visual-improvement claim is made by this field-membership assay.

## Identity

- Corpus identity: `sha256:dbd0a738ebda4a6423c36ed77eb9680bc6ee6891367a7057dab0785328f9b3e8`
- Corpus manifest SHA-256: `b7af257e7b5a0a033211d78eae9039c48d57e8f27150a36eef009bae4d66f708`
- Implementation commit: `b4a95b4ee106672bfbda0a3278fb3c4723e99afc`
- Implementation script SHA-256: `142f533595c8f2b4ef57200ae32c9ef36f902897628b9e4fec701cc874cf44f0`
- Assay manifest SHA-256: `5090762b7297edbe42f241069baec4efef02c271f8e04d35ae731033c4694838`
- Selector recipe SHA-256: `541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9`
- Runtime: 33.79 seconds, CPU, 35,651,584 rows evaluated, zero rows dropped

## Command

```sh
python3 volume-nonridge-explicit-support-assay.py \
  --corpus-manifest /path/to/checksum-bound/corpus-manifest.json \
  --corpus-manifest-sha256 b7af257e7b5a0a033211d78eae9039c48d57e8f27150a36eef009bae4d66f708 \
  --out-dir artifacts/nonridge-explicit-support-assay-control-aware-clean-0716 \
  --calibration-setting setting-q
```

## Verification

```text
python3 -m py_compile volume-nonridge-explicit-support-assay.py
node tests/volume-nonridge-explicit-support-assay-contracts.mjs
node tests/volume-nonridge-source-basis-ridge-assay-contracts.mjs
node tests/volume-nonridge-source-basis-corpus-contracts.mjs
git diff --check
```

All commands passed. The focused contract includes a control-confounded black fixture, exact production Ridge coefficients and threshold, optical hard-positive truth table, x-fastest neighborhood operators, world-grid-spacing-scaled gradients, deterministic reruns, checksum and same-descriptor custody gates, split identity checks, and stale-success invalidation on failure.
