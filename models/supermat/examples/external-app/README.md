# SuperMat Material Studio

Choose an image, infer its materials, inspect the maps, and download PNGs.

Copy this folder into your own project and run:

```sh
npm install
npm run dev
```

Open the localhost URL printed by the server in a WebGPU browser. Set `PORT` to use another port. Model weights load on the first inference; the included backpack is a source image, not a precomputed result.

`npm run build` creates `dist/app.js`, its image asset, and the SuperMat CPU worker. Deploy `index.html` and `dist/` together over HTTPS.

`app.js` owns image selection, inference, map selection and PNG export. `image-view.js` draws the selected image on the model's GPU device, submitting redraws through `app.foreground` when the view changes. The model remains available for subsequent images and is released on page exit.

The app imports the published `@kaminos/supermat` package. It needs no parent checkout, Python server or local weights. See the [package API](https://www.npmjs.com/package/@kaminos/supermat) to integrate the model into an existing application.
