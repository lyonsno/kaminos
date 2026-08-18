# Paired procedural-groom threshold result

## Decision-bearing result

The controlled geometry manipulation succeeded: changing only lower-ruff fiber length from `0.34` to `0.85` (`2.5×`) made the lower field a constitutive collar/mane feature while preserving the upper coat, density, cameras, lighting, palette, and whisker system.

Gemma 3 4B did not produce an explicit ruff proposal in either arm. The subtle arm proposed `main_fur`, `left_muffler`, and `right_muffler`; the constitutive arm proposed `main_fur`, `cheek_fur`, `whisker_left`, and `whisker_right`. This is a model-specific negative for `mlx-community/gemma-3-4b-it-qat-4bit`, not evidence against VLM-guided regional decomposition and not a reason to retune the fixture before a more capable observer is tested.

The current SAM candidate policy failed separately. It unions every returned detection above threshold `0.1`; the resulting masks commonly flood the background or most of the head. For example, constitutive-arm front `main_fur` reached recall `0.999` against the puffy coat but precision only `0.038`, and left-three-quarter `whisker_left` reached recall `0.998` against the left mystacial pad but precision only `0.106`. These overlays are failure evidence, not admitted semantic regions.

## Route and terminal receipts

- Constitutive Blender source: Greenroom job `75d5638fde63`; Blender `5.1.2`, EEVEE; `43,560` coat fibers plus `14` whiskers.
- Subtle VLM: Greenroom job `95f3aa3fd089`.
- Subtle SAM: Greenroom job `daa331ee6d16`.
- Constitutive VLM: Greenroom job `19468c5f4d0e`.
- Constitutive SAM: Greenroom job `9d85fb63787d`.
- VLM route: `mlx-community/gemma-3-4b-it-qat-4bit`, MLX Metal.
- SAM route: `mlx-community/sam3-bf16`, MLX Metal, threshold `0.1`.

Process terminality is distinct from visual or scientific admission. All raw inventories, reports, masks, overlays, comparisons, effective-route records, and digests remain under the two run roots.

## Evidence surfaces

- One-page visual and estimator sheet: `artifacts/procedural-groom-presentation-v0/review-ruff-threshold-pair.html`
- Subtle run: `artifacts/procedural-groom-estimation-runs/subtle-density12x-gemma3-4b-v0/`
- Constitutive run: `artifacts/procedural-groom-estimation-runs/constitutive-ruff2p5x-gemma3-4b-v0/`
- Reusable contract and exact commands: `artifacts/procedural-groom-estimation-harness-v0/README.md`
- Parameterized assay config: `artifacts/procedural-groom-estimation-harness-v0/assay-config.json`

## Claim ceiling and next mechanism assay

This establishes one authored-fixture observation about Gemma 3 4B proposal behavior and exposes an overpermissive SAM union policy. It does not establish the behavior of stronger VLMs, arbitrary-source semantics, production grooming, or 3D recovery.

The cheapest independent next mechanism assay is to preserve SAM's individual candidate masks and compare current union-all against top-1, box-contained, and overlap-suppressed selection on the same sealed VLM proposals and truth masks. That assay should not overwrite the raw paired evidence, and its result should remain separate from the later stronger-VLM comparison.
