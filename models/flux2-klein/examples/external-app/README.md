# Klein Image Studio

A small image-generation application built with `@kaminos/flux2-klein` and a WebGPU image viewer. Enter a prompt, generate, inspect the image and download it. Subsequent generations reuse the loaded model.

## Run

Use a browser with WebGPU and `shader-f16` support, such as current Chrome, and Node.js with npm for the development server.

```sh
npm install
npm run dev
```

Open the local URL printed by the server. The included sample appears immediately; model weights download on the first Generate. This folder is self-contained and can be moved out of the Kaminos checkout.

## Adapt

- `app.js` owns the model, form, progress, stop action and PNG download.
- `image-view.js` renders the current image on the model's WebGPU device. Pan, zoom and resize request foreground work rather than competing with inference on a separate frame loop.
- `index.html` contains the controls and styles.

Run `npm run build` and serve this folder over HTTPS or localhost for deployment, including `index.html` and `dist/`. Weight hosting can be changed with `pipelineOptions.weightsBase` in `app.js`, or `?weights=https://your-host/path` when opening the app.

The [model API guide](https://www.npmjs.com/package/@kaminos/flux2-klein) covers model options and sharing an existing device or inference session.
