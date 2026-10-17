# Analytical piston arm

`piston-arm-kit.mjs` builds the flame arm from ordinary boxes and cylinders,
four ordinary rigid groups, and the existing length/hinge actuator. The template
supplies the existing fire recipe, domain, lighting and view; its generated
meshes and old mechanisms are replaced in a new document, never in the input.
No inference or new runtime solver is involved.

```sh
node tools/piston-arm-scene.mjs --template existing.kaminos.json \
  --out analytical.kaminos.json --parameters dimensions.json
```

The optional parameter file contains `height`, `reach`, `thickness`, `cupRadius`
and an ID `prefix`; defaults are .665, 1.1, .10, .14 and `analytical-arm`.
Dimensions are world units. The output path must be new. Open the saved filename
in the same Kaminos scene mount. The existing Piston workshop operates it.
Select the **Analytical barrel** group for the actuator controls. Primitive
dimensions and materials remain editable through the ordinary inspector; after
changing mounting geometry, detach/reinstall the actuator reference as usual.

`pistonArmScene(template, parameters)` is the same pure function used by the CLI.
Its output is an ordinary authored scene. `provenance.analyticalCarrier` names
the parameters, primitive membership and four actuator role IDs; these are
known source-side labels, not inferred segmentation of a generated result.
Keep the carrier document as the canonical source even if a later scene-save
adapter does not preserve that supplemental provenance field.

The intended next experiment renders this known carrier, asks an image generator
to elaborate its appearance, reconstructs it, and tests recovered part ownership
against the known moving groups. Whole-object alignment is not part ownership;
generator-created bridges across the hinge or sliding gap are a concrete failure
to expose. This kit establishes the editable source and movement, not that
generation/reconstruction/registration already preserves those boundaries.
