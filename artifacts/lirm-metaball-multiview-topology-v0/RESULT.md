# Bowplan Multiview Topology Result

All four outputs are complete, route-valid, visually inspected, happy, and nonhostile.

## What changed

The view sequence, prompt, seed, generator settings, and three-reference route stayed fixed at `[target, side, target]`. Only the carrier modality occupying the two target-view slots changed. The all-depth control reuses Greenroom job `6917deba1f78`; the three new jobs are `9fd910ef1c95`, `a080b702ca49`, and `e8fe12abb49a`.

## Result

Target modality has strong presentation authority and weak low-frequency morphology authority in this fixture:

- `depth/depth/depth` preserves the authored body/support organization and converts the carrier into a pale furred organismal surface;
- `clay/depth/depth` preserves nearly the same silhouette but copies the olive body, purple feet, and smooth implicit presentation;
- `normal/depth/depth` again preserves the broad silhouette while copying the normal encoding into blue-purple appearance;
- `clay/depth/normal` converges closely on the clay-target result rather than combining clay structure with normal-derived elaboration.

Whole-frame SSIM reflects the appearance changes, but an exploratory background-relative mask shows stable silhouette: depth versus clay `0.9596` IoU, depth versus normal `0.9342`, depth versus clay-plus-normal `0.9581`, and clay versus clay-plus-normal `0.9867`. This mask was computed after inspection and is diagnostic only, not an admission threshold.

## Interpretation

The strongest supported model is now a partial authority separation:

- complementary view content controls low-frequency completion;
- the first target-view modality strongly controls material and presentation;
- adding a normal target in slot three does not recover independent local structural elaboration when clay occupies slot one;
- all-depth conditioning currently gives the best organismal elaboration while retaining nearly the same coarse silhouette.

This is not a general carrier ranking, camera-recovery result, or multiview-consistency proof. The current source remains directionally ambiguous, and no descriptor-only head/rear label is used to judge the outputs.

## Next experiment

Move to the asymmetric visible-source sentinel and test typed authority separation directly. The smallest successor is not another broad modality sweep: compare target-projection depth alone against target-projection depth plus a clearly separate appearance clay reference. Promotion requires the appearance reference to improve finish without moving the sentinel's protected contour, marker order, support order, or projection class.
