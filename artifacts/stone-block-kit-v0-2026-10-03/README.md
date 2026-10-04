# Rough-cut limestone block kit

Five closed, textured visual prototypes for repeated body-owned masonry instances. All variants fit the same centered envelope: width0.28, height0.30576, depth0.2123333333 in uncalibrated simulation coordinates. +Y is up, +Z is front. Node transforms are baked; the pivot is the body center. Geometry consists of shallow inward bevels and small corner flakes, leaving broad mating faces at the common box planes. Each GLB embeds base-color, tangent normal and roughness maps.

`descriptor.json` names the variants, exact measured bounds, triangle counts, seeds and file hashes. Choose variants deterministically from stable body identity and apply the existing body's pose. These assets supply appearance; collider, connection, damage and motion authority belong to the consumer. Loading and body-contact correspondence require the consumer's adapter witness.

Regenerate with Python plus NumPy and Pillow:

```sh
python tools/generate-stone-block-kit.py --out artifacts/stone-block-kit-v0-2026-10-03
python tests/stone-block-kit-contracts.py
```

These are procedural authored prototypes. They are not image-to-3D outputs or calibrated stone material models.
