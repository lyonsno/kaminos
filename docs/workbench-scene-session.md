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

All hooks are required. They close over the application's actual services:

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
`onFrame`, and `dispose`. Disposal immediately disables callbacks, requests load
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
