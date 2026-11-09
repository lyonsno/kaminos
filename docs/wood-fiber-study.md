# Finished wood fiber study

Open `?workspace=workbench&experiment=wood-fiber` on this branch. Left: measured diffuse color with the host GGX surface model. Right: the same surface model plus the analytic subsurface fiber response from Marschner et al., *Measuring and Modeling the Appearance of Finished Wood*, SIGGRAPH 2005. Set Fiber strength to 0 to compare the same right-hand surface under identical angles.

## Controls and their scope

| Control | What it changes |
|---|---|
| Measured wood sample | Loads the author's measured color/fiber maps for curly maple, padauk or either walnut sample. Optical settings and camera are retained during switching. |
| Fiber strength | Scales the extra subsurface-fiber contribution on the right. Zero leaves the ordinary surface model. |
| Surface roughness | Changes the host GGX surface highlight on both slabs. It does not change the width of the fiber lobe. |
| Fiber lobe width | Multiplies the measured beta highlight-width map on the right. One uses the measured values. The author's Gaussian expression also couples its amplitude to beta. |
| Fiber medium IOR | Changes refraction and interface attenuation in the extra fiber term. It does not change the host GGX layer's fixed dielectric F0 or implement a separate full coat layer. |

Use normal Kaminos scene lights through Add → Light and the native light inspector. The experiment creates no private light. Its old experiment-owned comparison-light group and Light angle control were removed because that group lacked a reconstructible source for native Delete/Undo. Existing old `azimuth` experiment inputs no longer aim a private light; use native scene-light poses. Lights you author remain ordinary scene objects, independent of this material tool.

The experiment borrows the existing scene, camera and renderer. It adds its two slabs through a scene session and removes them on close. Normal scene lights illuminate both the surface and the fiber term. Opening the tool does not delete or replace scene lights or other authored objects.

## What is implemented

This is our WebGPU/Three integration of a published optical model and the author's measured flat-patch data. It is separate from the 2016 procedural solid-wood model and the 2022 knotted-wood code. It contains no neural training or wood-growth simulation. Box faces repeat the measured patch; it is not recovered TRELLIS material or a coherent solid volume. Color, fiber-axis direction and fiber color are fixed measured maps; width is a measured map multiplied by the exposed control.

The host GGX surface uses Kaminos screen-space reflections and environment illumination. The added fiber lobe currently evaluates direct scene lights only; it does not integrate SSR, environment or custom flame irradiance. A scene with only coplanar slabs offers little geometry to reflect. Inspect surface SSR with a colored scene object above/behind a slab, low Surface roughness, and enabled reflections. This is not proof of physically complete fiber response to reflected illumination.

The GGX surface differs from the author's original RenderMan shader; this is a hybrid optical study, not complete-renderer parity or energy-conserving layering. No performance result has been established.

Source: https://www.cs.cornell.edu/~srm/publications/SG05-wood.html . The downloaded author archive supplies diffuse color, fiber axis, fiber color and beta maps. WGSL is independently expressed from the published model. Author maps remain local research assets; no redistribution license was established and none is committed here.

## Data and reconstruction

The default manifest is mounted through generated-meshes at `wood-fiber-study-1108/manifest.json`. It records source and SHA256 of each little-endian RGBA float32 map, derived from 16-bit linear TIFF without resampling. Upload uses half-float textures. Fiber scale 20 and axis conventions follow the author shader. An identical central UV window selects all channels, avoiding measurement borders/marks. Complete source files remain retained. Missing channels, invalid descriptors and hash mismatches refuse loading.

Pass another manifest and sample through `experiment_inputs`. Inputs retain initial `sample`, `fiberStrength`, `roughness`, `fiberSpread`, `ior` and `view`. Parameter operations update the common experiment inputs; the selector reopens through the same common entry used by agents. `window.kaminosWorkbenchExperiments.read()` returns accepted values. Generic scene Save does not reconstruct this custom material; reopen through experiment inputs.

Run `npm test -- --only tests/wood-fiber-native.mjs,tests/wood-fiber-material.mjs`. Native tests execute production WGSL on Apple WebGPU, covering the fiber cone, inclination, backlighting and finite grazing response, with a compiled disconnected-contribution control. Material tests cover missing channels and editable optical parameters. Browser checks cover the actual scene, controls, sample switch, native light Delete/Undo/Redo, and reflection on/off captures. These are functional inspections, not frame-budget benchmarks.
