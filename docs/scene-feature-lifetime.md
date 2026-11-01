# Scene feature lifetime

The application composes authored water and retained flame through feature
owners. Scene membership, document binding and domain algorithms keep their
existing owners. These adapters govern runtime admission and retirement.

`createAuthoredWaterFeature` receives borrowed render/scene services, current
source readers and UI projections. It owns the accepted setup and water host.
`restore()` restores finite sources as an editable preview without importing
solver code; continuous sources mount their runtime. `release()` prepares a
replacement while the admitted runtime remains usable, then publishes only the
current request. Failed preparation preserves the admitted runtime. Successful
replacement retires its predecessor. `reset()` returns to authored preview;
`clear()` also drops setup; `restart(next)` retires work while retaining the
replacement recipe. `fail(error)` retires failed work while retaining authored
setup and the error for presentation. Rendering still occurs inside the existing
application frame; this owner creates no frame pump.

Workbench `host.fluid.open()` uses the same water owner through
`openExperiment(setup)`. The experiment receives its existing numerical
capability. Closing an older capability cannot remove a newer host. Scene clear
invalidates both pending authored and experiment activation. Runtime factories
must release only their own solver/presentation resources and preserve borrowed
scene, camera, renderer and device.

`createAuthoredFlameFeature` controls activity of a borrowed flame prototype.
`setActive`, `sync`, `restore` and `clear` reconcile work through its existing
`setActive` operation. `restore` carries document-currentness so an obsolete
completion cannot revive a retired field. Clear and visibility changes deactivate
work while retaining the prototype and simulated state. GPU construction,
cooperative scheduling, lighting and volume rendering remain producer contracts.

The application supplies current services explicitly and calls these lifecycle
operations at its scene/Workbench boundaries. Domain editing, source sampling,
record projection, frame composition and first-flame construction still have
page adapters. This change does not make every feature an interchangeable plugin
or complete the extraction of those remaining responsibilities.

Behavior tests cover replacement, failed preparation, stale arrivals, lazy
preview, borrowed runtime retirement and scene restore. Native checks must also
exercise the actual authored scene and Workbench routes; injected factories
alone do not establish the GPU/presentation contract.
