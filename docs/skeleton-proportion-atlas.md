# Skeleton proportion reference atlas

The `marionette/rest-skeleton` Workbench accepts an optional `proportion_atlas` in its normal editor input. The contextual inspector compares actual rest-joint origins as the person edits. Reference choice uses shared Undo/Redo, retains the reference object's placement, and saves with **Skeleton file → Save skeleton…**. Opening that saved skeleton restores the atlas, chosen reference, source identities and authored geometry. Ordinary Scene Save still does not reconstruct rest anatomy.

`experiments/creature-motion/skeleton-proportions.mjs` owns the deterministic measurement contract. `measureSkeleton(skeleton, profile)` accepts `{joints:[{name,parent,head}]}` or a reference's `{jointNames,parents,positions}`. `profile` is explicit `kaminos.quadruped-correspondence.v1`: `id`, `authority`, a two-landmark `trunk`, and `fore`/`hind` objects each with `left`/`right` ordered semantic chains of at least three landmark names. Chains may span intermediate graph joints; measured length follows every actual origin edge. Rest bends use the first three declared landmark positions and are not joint limits. Bone display tails, scene placement and camera are excluded.

The first descriptor comprises shoulder/hip widths divided by trunk endpoint distance, their ratio, total fore/hind chain lengths and ratio, first segment fractions, first rest bends, and bilateral chain-length differences. Reach is chain length, not IK reach or a physical feasibility claim. The exact landmark definitions and supplied authority matter: different distal endpoint conventions change chain fractions. Widths are distances between bilateral limb-origin landmarks, not thorax or tissue breadth. L/R length difference does not detect all positional asymmetry.

The atlas schema `kaminos.skeleton-proportion-atlas.v1` holds candidate `profile`, `activeReference` and `references`. Each reference has a unique `id`, `label`, `source:{path,sha256}`, raw graph/positions and its own `profile`. Source identity belongs to the caller; when served through the normal digested recipe it is bound to that input, not independently authenticated against an external file by the measurement module. The live reference object exposes active identity in `userData.proportionReference`, while the scene registration names the caller's atlas. A partial correspondence yields missing cells and reasons; unknown correspondence yields `unsupported`. Degenerate inputs fail visibly. There is no validity score, nearest-reference rank or automatic correction.

Headlessly, use the same saved skeleton or editor input:

```sh
node scripts/skeleton-proportions.mjs --input /caller/skeleton.json --out /caller/proportions.json
```

The caller chooses both paths. The report retains input digest, effective deterministic route, measurement and failure phase even when measurement fails. It invokes no model and makes no anatomy or motion-support inference. The interactive experiment's `proportions` operation returns the same measurement. Optional soft constraints and a measured motion-support envelope remain subsequent work, not capabilities of this first comparison tool.
