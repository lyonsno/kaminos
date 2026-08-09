# Operator structure variants

These derivatives isolate anatomical organization from representation density. Start from the current `cat-bauplan-025.blend` envelope, retain its evaluated polygon budget, camera, framing, pose, and gross outer dimensions, and edit vertex positions rather than decimating.

## S1: generic but coherent

Remove anatomical specificity while preserving an intentional quadruped:

- blend the scapular and upper-arm transition into a generic front-quarter mass;
- blend the pelvis, flank, and proximal hind limb into a rounder rump;
- make the lower limbs more uniformly post-like;
- simplify the neck-to-head transition into a more uniform carrier.

The result should still look designed and pleasant. It should contain less information about how the major masses articulate.

## S2: structurally weak but coherent

Preserve mesh density and recognizability while weakening the mechanical relationships:

- lower or advance the shoulder mass so the front support no longer resolves cleanly into the trunk;
- reduce the visible pelvic-to-femoral organization and straighten the rear chain;
- make front and rear supports more mutually generic;
- keep the silhouette free of accidental holes, repetitions, growths, or corrupt-looking surface features.

This is not random damage and not an intentionally ugly creature. It is a plausible authored envelope whose load paths and joint organization are less legible.

Export one camera-identical render for each variant. Do not change polygon count, material, background, framing, prompt, seed, or generator settings. Those become the three fixed-density cells `S0 current`, `S1 generic`, and `S2 weak`.
