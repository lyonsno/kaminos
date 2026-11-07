# Shape conditioning

Select an image in Assets or the experiment browser and choose **Shape conditioning…**. **Prepare foreground & recover depth** uses the existing image preparation route and MoGe on the application's shared WebGPU device. It waits for Greenroom admission and releases MoGe resources after the run. No image generator runs when adjusting this tool.

The source stays on the left and the conditioning output on the right. Form smoothing averages nearby foreground surface positions and normals in 3D. Boundary softness changes the Gaussian support of those points; their accumulated optical density resolves to coverage. Clay appearance replaces the photographed surface with neutral shading, independently of form smoothing. Contrast, coverage density and the background can also be adjusted. Numeric fields accept values beyond the sliders' initial display ranges, except for the clay mixture's natural zero-to-one range.

**Save conditioning image** stores a PNG in Source images and adds it to the originating experiment when one was captured. **Save & use as reference** additionally opens the ordinary Generate workflow with that output as its image reference. It does not start generation. Reopen a saved result with **Edit conditioning…** to recover the same settings and retained geometry without another inference run.

The browser and agents use the same operations:

```js
await kaminosAssets.conditioning.open(entry, {experiment: {id, title}});
await kaminosAssets.conditioning.recover();
kaminosAssets.conditioning.set({form: 6, boundary: 4, clay: 0.7});
// Wait while read().rendering before saving a changed form.
const image = await kaminosAssets.conditioning.save();
kaminosAssets.conditioning.close();
```

`read()` exposes the actual source, settings, retained geometry reference, status, error and saved result. Form smoothing runs in an owned worker; other preview changes render immediately. Closing releases preview resources. The PNG's `kaminos.image-conditioning.v1` metadata retains its original image digest, derived-image ancestry, author, captured experiment, settings, projection and geometry artifact identity. The binary geometry lives in the shared `image-conditioning` asset root, configurable with `KAMINOS_IMAGE_CONDITIONING_DIR`; its content digest is checked when reopened. `/api/image-conditioning` writes and looks up those same artifacts for headless callers. The binary format is a little-endian header byte length, UTF-8 JSON header padded to four bytes, then float32 depth and interleaved XYZ normals at the header's raster dimensions.

This first operator uses visible source-camera depth, normalized by median depth and projected through illustrative pixel rays with focal length equal to image height. It preserves the source framing; it is not a calibrated, complete object reconstruction. It does not fill unseen surfaces or supply arbitrary-view rendering. Background removal can affect small openings and shadows; its exact prepared source is retained alongside MoGe's route receipt. The 3D smoothing and finite Gaussian support are a conditioning transformation, not a change to the original model arrays. Known CAD depth can use the domain functions, but a scene-depth capture UI is not part of this first image-source integration.

Current render route: `source-camera-gaussian-coverage.v1`, using WebGL2 float accumulation for this offscreen image operation. MoGe remains WebGPU; no scene renderer, layout mode or generator is replaced.
