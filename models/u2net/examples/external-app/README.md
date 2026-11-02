# U2Net Cutout Studio

A small background-removal application built with `@kaminos/u2net`. Choose or drop an image, remove its background, compare the source and cutout, then download a transparent PNG. The viewer shares the model's WebGPU device and keeps pan, zoom and comparison usable during inference.

## Run

Use a browser with WebGPU, such as current Chrome, and Node.js with npm for the development server.

```sh
npm install
npm run dev
```

Open the local URL printed by the server. The included backpack appears immediately; weights download on the first removal. Subsequent removals reuse the loaded model. This folder is self-contained and can be moved out of the Kaminos checkout.

## Adapt

- `app.js` owns image selection, the model, controls and PNG export.
- `image-view.js` renders source/cutout comparison through the model's foreground service. It requests frames when the view changes, without a competing animation loop.
- `progress-view.js` displays existing preparation/mask phases and elapsed time. Unknown download and inference totals stay indeterminate.
- `image-io.js` decodes browser-supported images and exports the returned RGBA bytes as PNG.

The application preserves existing transparency without invoking U2Net. For opaque images it uses the package's unmodified rembg-compatible output, including the maximum 1024-pixel source resize. Output dimensions appear with the cutout. Background swatches affect only the preview, not the downloaded alpha channel. The included backpack is the same sample used by Kaminos Material Photograph.

Run `npm run build` and serve `index.html` and `dist/` over HTTPS or localhost. To use your own weight host, supply `weightsUrl` in `app.js` or open `?weights=https://your-host/path/`. The loader still checks package byte count and SHA-256.

The [model API guide](https://www.npmjs.com/package/@kaminos/u2net) covers sharing an existing device/session and the lower-level producer exports.
