# Current mannequin registration successor: result

## Campaign state

The more anatomically plausible authored envelope remains strongly legible under concise neutral FLUX elaboration. All three selected results also reconstruct into Trellis casts that accept the authored skeleton under a single global similarity transform. The concern has moved from "does reconstruction destroy the authored body plan?" to local correction around paws, tail, head treatment, and surface class.

The strongest smooth candidate is `mannequin-seed80413`: its envelope-to-cast nearest-surface distance is `0.93%` median and `2.67%` p90 of cast bounding-box diagonal after the global fit. These numbers are diagnostic, not anatomical admission.

The historical authored-envelope cast has now been replayed through the same fitter. It measures `0.93%` median and `3.23%` p90. The best current cast improves the tail of the distance distribution but not the median, while `mannequin-seed80301` is worse at `1.43%` median and `4.05%` p90. There is no clean general TRELLIS-registration improvement. The stronger result is upstream: the revised envelope repeatedly keeps FLUX inside a coherent carnivoran basin while preserving the authored axial and limb organization. Historical and current prompt wording also differs, so this comparison cannot isolate the source revision causally.

## Prompt and seed result

`mannequin` and `armature` wording produced less variation than changing the seed. Both neutral prompt classes preserved the main authored silhouette. The two seeds elaborated into distinct coherent creature basins while retaining the source's broad axial, shoulder, pelvic, and limb proportions. Seed `80413` repeatedly selects the fox/wolf-like basin across prompt labels; seed `80301` repeatedly selects the heavier cat/dog-like basin. The apparent near-half fox rate is therefore two seed-stable basins replicated across prompt variants, not six independent species draws.

The concise fur prompt entered a genuinely different surface basin. FLUX produced a coherent furry creature and Trellis reconstructed an explicit dense outer layer rather than only painting a fur texture. That cast took `607.4s` and contains `206,813` vertices, versus `53.9-62.2s` and `124,243-148,476` vertices for the two smooth casts.

## Fur interpretation

The fur cast is not clean strand geometry. It is a dense, jagged, clumped microgeometry shell. Its core body still registers strongly (`1.07%` median, `3.49%` p90), while paws swell and the tail becomes shorter and thicker.

The official TRELLIS.2 furry-bear example clarifies the representation boundary. Its input depicts fur as broad, sharply separated, overlapping tufts, and its reconstructed output carries those tufts as explicit meso-scale geometry. It is not reconstructing a conventional strand groom. Our short stochastic cat fur asks TRELLIS to recover a much higher-frequency field than the official example. A matched broad-tuft prompt is therefore the next useful fur assay; repeating a generic `fur` prompt is not.

This evidence does not choose between preserving and regularizing Trellis-derived fur geometry versus replacing it with a conventional groom. The next discriminating experiment is semantic surface separation followed by two cheap probes on the same cast: determine whether the outer shell can be isolated without cutting the underlying body, then determine whether its local orientation and density remain coherent enough to drive motion carriers. A successful separation plus coherent field supports using the generated shell directly or as the guide for a cleaned representation. Failed separation or incoherent orientation supports replacement while retaining the cast only as a semantic reference.

## Evidence surface

Open `campaign-screen.html`. It keeps the authenticated source plate, exact prompt, seed, FLUX route settings, FLUX output, Trellis views, cast identity, and global-fit overlays adjacent. Registration overlays carry the authored envelope and all 67 co-located skeleton objects through the same transform; they make no local anatomical edits. The historical section applies the same global-only fit to the earlier authored envelope and cast.
