# Pause A Model Invocation

Available in Kit 0.1.56. One invocation owns one control, shared by its leaf
GPU and CPU duties:

```js
import { createWebGpuInferenceControl } from '@kaminos/webgpu-inference-kit/core';

const control = createWebGpuInferenceControl({
  queue: device.queue,
  signal: abortController.signal,
  withForeground: foregroundRun.withForeground,
});
// Pass inferenceControl: control to each createWebGpuCooperativeExecution or
// runtime.runProgram call. Wrap other leaf work with control.runDuty(work).
// Close the control in the invocation's finally, before foregroundRun.finish().
await control.pause();
await control.resume();
abortController.abort(); // Stop also wakes parked duties.
```

`pause()` closes admission synchronously. Its promise resolves when admitted
duty callbacks have settled, a queue-prefix fence has resolved, and the
foreground window is open. `snapshot().status` distinguishes `pausing`,
`paused`, `resuming`, `running`, `cancelled`, `failed`, and `closed`.
Resuming before pause completes withdraws the request; that pause promise may
return a non-paused snapshot. `resume()` waits for the foreground window to
settle before model admission reopens. A new pause during resume remains in
force. No additional queue fences run on the ordinary unpaused duty path.

Each control applies to one queue and one invocation, not the entire browser
or device. The caller supplies the queue actually used by those duties. The
same AbortSignal must reach the controller and cooperative executors. Pass
the existing run's `withForeground` to keep a persistent foreground service
running while parked. Without that callback, the control only parks model
admission; it cannot service an external renderer's queued requests.

Use this at leaf boundaries, not around an entire model call that itself
enters controlled duties. Awaiting `pause()` inside an admitted duty would
wait for that same duty to finish. A duty may request pause without awaiting
it; user controls normally request it externally. Unwrapped work is outside
the pause contract, including weight loading, uploads, direct queue submits,
CPU loops, and worker phases. Wrap finite leaf work, or add cooperative
boundaries, before advertising whole-invocation support. Already-admitted
work runs to its existing boundary; no kernel or synchronous CPU preemption
is implied. Weight and intermediate memory remain resident.

The invocation owner awaits `control.close()` in cleanup before ending its
foreground run. Close seals admission, wakes parked callers, waits active
duty callbacks and any pause transition, and removes the abort listener.
It does not replace the producer's normal terminal GPU drain or resource
retirement. Fence or foreground-window failure seals the controller; do not
resume or release model resources on the strength of a failed pause.

Backport first through the model's shared adapter factories, not its kernels.
SF3D's thin cooperative runtimes are supported through the executor's
`inferenceControl` option; full runtime phase programs accept the same option.
Ports must explicitly thread it across all their executors and remaining
leaf phases. Rebuilding against a new Kit version alone does not add this
coverage or a Pause button.
