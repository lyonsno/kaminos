# Kaminos

Kaminos is a spatial studio for generated worlds.

It is not just an asset viewer. The goal is to make generated assets usable by
moving them through a full spatial workflow: build them on the bench, stage them
in controlled rigs, enter world chambers where they participate in local rules,
and preserve the provenance and witness truth needed to know what actually
rendered, simulated, or changed.

## Shape

Kaminos is organized around three spatial modes:

- **Workbench / Kiln:** inspect and transform assets, materials, splats, terrain
  fields, simulations, receipts, and prototypes.
- **World Chambers:** enter visitable worlds that keep their own ontology,
  interaction laws, camera posture, and debug surfaces.
- **Forge Floor:** keep long-running work, processes, and eventually embodied
  operational agents spatially reachable without flattening every world into a
  generic dashboard.

The first public story is the generated-world studio. The deeper north star is a
forge where generated matter, world logic, witnesses, and operational presence
can coexist spatially.

## Why

Generated assets need more than isolated previews. A useful generated object
must survive movement between contexts:

1. **Inspect:** see the object, material, transform, receipt, and route identity.
2. **Stage:** place it in a constrained rig or small test environment.
3. **Inhabit:** let it participate in a world chamber under that world's rules.
4. **Witness:** record enough source truth to distinguish live, fixture,
   fallback, stale, seeded, projected, or visual-only evidence.

Kaminos treats those as postures of the same artifact rather than separate
throwaway views.

## Current Direction

The current north star is documented in
[docs/kaminos-north-star.md](docs/kaminos-north-star.md).

LERMS is the first worked example for the World Chambers model: a world where
Underhill, a Terrarium, and the Hill of Hills should feel like connected places,
not just a flat preview tab.

Existing implementation work is still early. The repository currently contains
asset, splat, scene, volume, and witness experiments that are being pulled
toward the Workbench / World Chambers architecture.

## Docs

- [Kaminos North Star](docs/kaminos-north-star.md)
- [Docs Index](docs/README.md)
- [Splat Assets](docs/splat-assets.md)
