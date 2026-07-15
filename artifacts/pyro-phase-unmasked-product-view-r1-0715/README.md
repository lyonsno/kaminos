# Unmasked Product-View Phase Correction R1

Question: does the response-anchored recurrent prediction remain product-shaped when the exact-target motion-cohort opacity mask is removed, and is the copied-current control truly visually frozen?

Result: the control is truly frozen, and the recurrent product-view gate fails. Both generation-two and response-anchored raw controls contain `63` frames but exactly `1` unique PNG hash, `85297c5c92376a584b73f4f88dad4fe798a6afeae261d2a95bd4655dafd4ce9e`. Both predictions contain `63` unique frames, proving real temporal change, but develop a saturated white diagonal low-frequency sheet. Frozen present reuse beats both models in same-raster PSNR at every frame; response anchoring beats generation two at no raw frame.

## Inspect First

Open `inspection-guide.html`. The four fixed columns are:

1. Exact held-out reference at each time.
2. One raw frame-zero present state reused identically for all 63 frames.
3. Generation-two recurrent prediction.
4. Response-anchored recurrent prediction.

No target-derived cohort changes opacity in the beauty sequence. Static and unmatched attenuation are both exactly `1.0`; every full splat retains its original opacity. The four-role video is finite `10.08 s`, `63` frames, `6.25 fps`, and does not loop.

## Correction To Prior Witness

The earlier `artifacts/pyro-phase-response-anchor-r1-0715/` beauty witness applied a different exact adjacent-reference cohort mask on every frame. It rendered one constant frame-zero control payload through that changing mask, causing the middle panel to move and become sparse. That witness remains valid for oracle-conditioned cohort diagnosis and its cohort metrics, but it cannot establish raw product-view motion or visual advantage over present-state reuse.

The unmasked sequence reveals that the diagnostic mask suppressed the low-change material where the recurrent visual collapse accumulates. The response anchor improves motion-cohort-local state and retained-energy metrics, but it does not mitigate the dominant full-state saturated sheet.

## Raw Same-Raster Metrics

| Role | All-frame PSNR | Steps 49-63 PSNR | Frames beating control | Frames beating generation two |
| --- | ---: | ---: | ---: | ---: |
| Frozen present control | `17.174660 dB` | `16.677406 dB` | n/a | `63 / 63` |
| Generation two | `14.365325 dB` | `12.811528 dB` | `0 / 63` | n/a |
| Response anchored | `14.279653 dB` | `12.683481 dB` | `0 / 63` | `0 / 63` |

Terminal PSNR is control `17.25`, generation two `12.95`, and response anchored `12.77 dB`. These compare exact-state and candidate-state splats through the same isolated offline raster. They are not analytical-raymarch scores, but they are a direct full-representation comparison under one renderer.

## Route

- Repo/worktree: `/private/tmp/kaminos-pyro-phase-lag-counterfeiter-0713`
- Branch/base head at generation: `cc/pyro-phase-lag-counterfeiter-0713` / `c102be2`
- Mode: `raw-product-view`
- Static attenuation: `1.0`
- Unmatched attenuation: `1.0`
- Resolution: `320x240` per role
- Corpus SHA-256: `d38028655e038df55af0fb5f1c9cfc5c40f3464992ebd26b106c29b234f88c78`
- Generation-two predictions SHA-256: `fc19c101f3a1297ef42415117a4bf7e2e66e03c5a193bb7fa8fd569a8ac3746d`
- Response-anchor predictions SHA-256: `0399ad81f1e0b33488136de228896d47dfb7287230afb077445e8ec294a89571`
- Backend/device: MLX / `Device(gpu, 0)` with null fallback, inherited from prediction receipts

```sh
node boundary-splat-motion-cohort-audit.mjs --manifest /private/tmp/kaminos-phase-lag-crosswind-basin-r1-0714/phase-corpus.json --predictions <predictions.json> --audit <motion-cohort-audit.json> --out-dir <output> --width 320 --height 240 --witness-mode raw-product-view --static-attenuation 1 --unmatched-attenuation 1 --partial-flow-debug-gain 0.625
```

Exact source identities, role hashes, encode commands, cadence, backend, and the pixel-identical control gate are in `receipts/*-unmasked-witness.json`. `receipts/raw-*-psnr.log` preserves all 63 per-frame same-raster comparisons.

## Claim Boundary

This proves that both recurrent candidates move without oracle opacity assistance and that the raw control does not move. It also falsifies product-view advantage on this held-out basin: both candidates lose to full present-state reuse and collapse toward a saturated low-frequency sheet. It does not establish analytical-raymarch error, multi-basin behavior, runtime composition, or that no differently trained state model can succeed.
