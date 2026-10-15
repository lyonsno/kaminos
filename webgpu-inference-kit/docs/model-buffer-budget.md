# Model Buffer Admission

An application sharing its WebGPU device can give model buffers an explicit allowance without changing the device or charging the renderer's allocations.

```js
import {
  createWebGpuInferenceRuntime,
  createWebGpuModelBufferBudget,
} from '@kaminos/webgpu-inference-kit/core';

const bufferBudget = createWebGpuModelBufferBudget({
  device,
  maxBytes: modelAllowanceBytes,
});
const runtime = await createWebGpuInferenceRuntime({
  device,
  queue: device.queue,
  routeId: 'my-model',
  bufferBudget,
});
```

Reuse the same budget for runtimes and resident resources that share this allowance. Session routes can pass it through `runtimeOptions.bufferBudget`. Runtime-created tensors, uniforms, and buffers use it; `createManagedBuffer` does too, while leaving destruction with its caller. Imported buffers are not reallocated or charged. Direct `device.createBuffer` calls remain outside the scope: allocate model buffers through the runtime or this budget, including staging and resident weights. Renderer allocations can continue using the device directly.

When runtime GPU timing is active, its resolve and asynchronous readback buffers share this allowance and remain timer-owned. Refused readback allocation retains the submitted timing batch for an explicit retry after the caller retires other resources. Timer disposal and readback completion destroy their respective buffers through the same completion-backed accounting. Query sets themselves are not buffer allocations and are outside the API-visible byte total; a refused initial resolve buffer releases the query set before runtime construction fails.

`maxBytes` is required; the library supplies no default. This is the sum of API-visible buffer sizes allocated through this scope, not physical GPU/RAM use. Preexisting buffers, textures, CPU/Wasm memory, renderer buffers and driver-private allocations are outside it. The app/model owner chooses an allowance with appropriate headroom; this guard alone does not establish that a model fits a particular machine.

An allocation exceeding the allowance throws `WebGpuBufferBudgetError` before calling the device. `error.memoryBudget` records the requested bytes, current charge, pending retirement bytes and allowance. Existing buffers remain owned and usable; the caller may retire unneeded resources, await retirement, then explicitly retry or report refusal.

```js
temporaryBuffer.destroy();
await bufferBudget.settleRetirements();
const allocationState = bufferBudget.snapshot();
```

Destruction does not immediately release its charge. A completion observation covers the queue work already submitted, then retires that destruction batch; later destructions receive a later observation. Synchronous destruction waves share an observation without fencing each allocation. This accounts for submitted work, not command buffers that will be submitted after their resources have been destroyed, and does not measure when the driver returns physical memory to the OS.

Device allocation exceptions roll back the reservation. Destruction/completion failures retain the charge and quarantine further allocation; `settleRetirements()` rejects rather than advertising reusable capacity. Runtime disposal still destroys only runtime-owned buffers, not caller-managed resident resources or the borrowed device. The budget does not choose residency, eviction, precision, or scheduling policy.
