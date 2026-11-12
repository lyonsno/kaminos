# Track A Selected Object Through Video

The source checkout includes a SAM 3.1 sequential tracker and a camera/video application. Select an object with an initial binary mask, then carry its mask through later frames. The tracker retains the model's temporal memory instead of running the text detector independently for each image.

Use [SAM 3 image segmentation](sam-getting-started.md) for an image and text prompt. This video interface takes a seed mask, not a text prompt. Its model preparation is separate from `kaminos-sam-model`.

## The Video Application

Serve the checkout and open `webgpu-inference-kit/examples/sam-video.html` in a WebGPU browser on localhost or HTTPS. Set **Model root** to the same-origin URL of a prepared stream package's `tracker-model-root.json`.

The page accepts a camera or uploaded video. Load the model, capture a seed frame, paint the object's initial mask, and start tracking. The result stays paired with its captured source, rather than placing an older mask over the latest camera frame. Overlay, mask and cutout views share the same result; Export Capture retains its source pixels and model outputs.

An uploaded clip pauses for seed authoring and between processed captures. The camera remains live; the loop captures its next image only after the previous inference completes. Pause, Resume, Stop and Unload apply to that running operation. Processing cadence depends on the model, input geometry, browser and device; a live source does not imply a camera-rate mask update.

## Call The Tracker

Use the source checkout's SAM module for this interface:

```js
import { createSam31VideoTracker } from '../src/sam.js';

const tracker = await createSam31VideoTracker({
  modelPackageRoot: '/models/sam31/tracker-model-root.json',
});
try {
  // Supply RGBA and mask arrays at tracker.imageWidth x tracker.imageHeight.
  const first = await tracker.initialize({
    rgba: firstFrameRgba, mask: initialBinaryMask, timestamp: 0,
  });
  const next = await tracker.track({ rgba: nextFrameRgba, timestamp: 1 });
  useMask(next);
} finally {
  await tracker.close();
}
```

`rgba` is a `Uint8Array` with four channels per pixel. The seed is a nonempty `Uint8Array` containing zero or one per pixel. Calls are serial; timestamps must be finite, nonnegative and strictly increasing. `reset()` starts a different object after the active call has settled.

Each result includes `frameIndex`, `timestamp`, `sourceImageSha256`, `objectSlot`, `maskWidth`, `maskHeight`, `maskLogits` and `objectScores`. The logits contain sixteen equal planes; select the returned `objectSlot` and threshold its logits at zero. The mask grid can differ from the input geometry. Resize logits before thresholding when constructing a source-size mask. Do not treat unused object slots as additional detected instances.

`createSam31LiveLoop({ tracker, getFrame, onFrame })` supplies backpressure for a camera or other asynchronous source. `start({ rgba, mask, timestamp })` initializes the selected object; `getFrame({ signal })` supplies each successor. `onFrame({ source, result })` receives the exact copied source pixels beside their result. The loop exposes `pause()`, `resume()`, `stop()` and `snapshot()`. The application remains responsible for stopping its camera and releasing the tracker.

## Share Your Renderer

Pass `inferenceSession` and `foregroundService` to the tracker to borrow the host's coordinated GPU device. Both must use the exact same device and queue. Frames use the shared application runner; actual model duties service foreground opportunities and controls before temporal state is committed. Closing the tracker releases its own route and model resources without destroying the borrowed session or renderer's device. Without a supplied session, the tracker owns its session.

The [video application source](../examples/sam-video.mjs) shows the complete host lifetime. The [shared runner guide](model-applications.md#shared-runner-for-port-authors) covers the common scheduling and ownership contract.

## Prepare A Stream Package

The video loader requires a checkpoint-authenticated SAM 3.1 model package with its learned stream controls. It does not accept the image detector's `tensor-manifest.json` or a two-frame verification fixture as a stream root.

For an existing exported SAM 3.1 base model package, extract controls from the matching official checkpoint with Python/PyTorch, then project the stream root with Node:

```sh
python webgpu-inference-kit/tools/sam31-stream-controls.py \
  --checkpoint /path/to/sam3.1_multiplex.pt --out /path/to/controls
node webgpu-inference-kit/tools/sam31-stream-model.mjs \
  --model /path/to/base/sam31-model-package.json \
  --controls /path/to/controls/controls.json --out /path/to/stream-model
```

Choose a new output directory on the same filesystem as the base package: projection hardlinks its unchanged static weights. Serve the resulting directory intact. The controls tool requires the pinned official checkpoint and verifies its digest; projection verifies checkpoint agreement, control hashes and base package identity. Model weights remain governed by Meta's SAM License.

This is the advanced source integration path. The image detector has the standalone Node-only installer; a corresponding single-command installation path for the complete video model is separate work.
