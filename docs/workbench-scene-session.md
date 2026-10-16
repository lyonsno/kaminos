# Shared Scene Sessions

`createOwnerSceneSession(hooks)` scopes the existing application's scene services
to an owner experiment. Hotwet's application adapter supplies `host.scene.open()`
by creating a helper instance. This module supplies the helper; the actual
application mount and browser consumer exercise are separate integration work.

An experiment loads its retained creature or attaches its comparison meshes,
uses the shared camera, and binds its domain operations through the existing
`create({host, inputs, record})` / `operations` / `mount` / `dispose` entry.
The shared scene remains the renderer's scene. Source units and arrival placement
stay with the host and owner; model inference is an explicit domain operation.

## Application Hooks

The core hooks below are required. They close over the application's actual services:

| Hook | Contract |
| --- | --- |
| `loadAsset(input, {signal, isCurrent})` | Load and register an asset; resolve its receipt. Each successful owned load creates an independently releasable registration. Preserve clips and source-native placement when requested. |
| `attach(root, options, {signal, isCurrent})` | Register an owner object or look up an existing borrowed object. `options.owned` is explicitly boolean. Borrowing preserves its parent and resource custody. Return the receipt. |
| `remove(receipt)` | Remove exactly this owned registration through application removal, respecting shared geometry/material references. May return a promise. |
| `readView()` / `setView(view)` | Read plain camera/navigation state and validate/apply a view to the existing camera. Synchronous; set returns effective plain state. Helper detaches these data values. |
| `redraw()` | Mark the existing renderer dirty. |
| `onFrame(callback)` | Subscribe to the application's frame service; return a synchronous unsubscribe function. Callback receives the host's frame value unchanged. |

Registration receipt: `{id, root, owned, clips, source, ...}`. `id` is a nonempty
scene ID, `root` the actual Three Object3D and `owned` explicitly declares whether
closing this session removes the registration. `clips` carries actual loaded
AnimationClips, `source` carries source identity. The helper freezes the receipt's
top-level fields while preserving actual object/clip identity. The application
adapter owns receipt validity and rolls back partial work before rejecting a load
or attachment. An asset loaded into an existing borrowed object must declare that
custody. Camera and renderer remain borrowed.

For the existing GLB loader, the host adapter retains `gltf.animations` alongside
its registered root while preserving current callers' `resolve(model)` behavior.
The adapter supplies cancellation/currentness to the actual loader. A successful
late receipt is removed only when owned; a borrowed object survives. A failed hook
retains its error and must already have cleaned its own partial construction.

## Owner Use

```js
const scene = await host.scene.open();
const asset = await scene.loadAsset(inputs.asset);
// Domain code binds its own controller to asset.root and asset.clips.
const stopFrames = scene.onFrame(frame => {
  controller.update(frame); // Producer interprets the host's documented clock.
  scene.redraw();
});
// Owner operations use the common recorder at meaningful intervention boundaries.
// Instance disposal stops its controller, then awaits scene.dispose().
```

The returned methods are `loadAsset`, `attach`, `readView`, `setView`, `redraw`,
`onFrame`, and `dispose`; application GPU/publication extensions are described below. Disposal immediately disables callbacks, requests load
cancellation, awaits late receipts and releases every owned registration, reporting
cleanup errors together. Repeated disposal returns the same promise. Caller must
await disposal before reusing the application slot. Host callbacks may still be
invoked after unsubscription; the helper suppresses these stale callbacks.

Frame subscriptions use the host's scheduler. Marionette's one-shot
`requestFrame`/`cancelFrame` controller can be adapted with a subscription that
unsubscribes before invoking its callback. The host supplies timestamp units;
the producer's existing paused-time exclusion stays intact. Simulation clocks
and device-drain/resource admission have their separate host/domain contracts.

## Capture Boundary

For retained animation, the owner holds the selected source frame while shared
capture collects the image, view and domain read, then restores the intended play
state. Retain frame/time, asset/clip/raw-source identity and camera alongside the
observation. Record replay/pause/seek and camera interventions through the existing
recorder. Frame ticks are transient rendering activity. The helper supplies
lifetime and view access; the domain supplies the actual hold/restore operation,
and the existing investigation layer owns capture and persistence.

`node --test tests/owner-scene-session.mjs` exercises the helper on actual Three
objects with injected host services. These tests establish lifecycle behavior.
Hotwet's real loader, registration, frame service and shared capture remain the
browser conformance boundary for each consumer.

## GPU Producers In The Application Scene

On the application host, `session.gpu()` returns the borrowed effective
`{renderer, device, adapter, scene, camera, controls, ownership:'borrowed', backend:'webgpu'}`.
It rejects an unavailable WebGPU route or a device/view that does not match the
application. It does not allocate another adapter/device and does not transfer
renderer, controls, camera or device disposal authority. Producers can impose
their own native-adapter requirements using the returned actual adapter info.

`session.onBeforeRender(callback)` is a separate synchronous publication phase.
The app calls it before scene shadows, depth/GI and beauty consumers in each
scene draw. Prepare asynchronously from `onFrame` or domain operations; publish
only a complete state here. A producer can retain its previous completed state
while its next step is pending. Returning a Promise fails the publication phase,
reports the error and blocks scene draws until that subscription is cancelled.
The host does not await a simulation step or treat a promise as publication.
Disposing the session cancels its publication subscriptions, including stale
callbacks. Call `session.redraw()` when a new state needs presenting.

An owned attachment can supply `finalize(root)`:

```js
const session = await host.scene.open();
const api = await createMyProducer({host: session.gpu(), participation: 'producer'});
const remaining = new Set(api.roots);
for (const root of api.roots) {
  await session.attach(root, {owned: true, metadata: {label: root.name},
    finalize(retiredRoot) {
      remaining.delete(retiredRoot);
      if (!remaining.size) return api.dispose();
    }});
}
session.onBeforeRender(() => api.publish());
// Domain scheduling owns advance/hold/resume and calls session.redraw().
// On experiment close, stop that scheduling, await api.quiesce(), then:
await session.dispose();
```

The finalizer owns the complete producer allocation, including its Three
resources; the app never combines it with generic tree disposal. Use it for
resources owned exclusively by these roots. It runs exactly once on final
retirement, including ordinary Delete or scene replacement. In-document Undo
keeps the actual producer root/resources alive until scene history releases
its references; closing a session may therefore finish before final resource
retirement. A retained object can reappear quiescent after closing its experiment.
For multiple roots sharing one producer, aggregate their retirement as above
so the producer is disposed only after every root retires. Cleanup failures are
reported and preserved; repeated retirement returns the same result.

This adds in-memory history retention, not a serialized producer checkpoint or
an asset reload recipe. Saved-scene admission keeps its existing source rules.
The producer owns safe quiescence, async simulation scheduling, reconstruction
and any supported physical placement; ordinary scene placement alone does not
establish physical rotation or scale support.
