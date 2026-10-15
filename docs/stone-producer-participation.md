# Stone Producer Participation

`createStoneRuntime({host, ui, parameters, participation: 'producer'})` prepares
the existing bounded native-WebGPU material without mounting its roots or
subscribing to a frame loop. The default `viewport` participation is unchanged.
The producer requires the verified shared renderer/device/adapter, scene, camera
and canvas controls; it does not require `subscribeFrame` in this mode.

`api.roots` contains the unparented material root and, when enabled, a separate
world-space finite-floor root. The caller owns mounting. `api.object` remains
the material root. This permits the existing scene-session attachment flow;
this producer branch does not implement the final application GPU capability.

`await api.advance()` submits a bounded simulation step without publishing or
reading state back in producer participation. `api.publish()` submits the
visible pose/topology together, returning `published` and the run/step, or
`pending` while input or a step is incomplete. The host calls publication before
its first rendering consumer, not once per shadow/depth/beauty pass. More than
one unpublished step is supported: GPU topology dirtiness remains latched until
publication. Both operations use the existing shared queue.

An explicit evidence step uses `advance({evidence: true, publish: true})`.
Physical observation helpers such as `settle` also publish their acquired state;
the caller holds its simulation/frame boundary for those diagnostic operations.
An unpublished step cannot claim surface evidence for its current state.

`await api.quiesce()` permanently stops input/frame participation, drains pending
work and GPU submissions, and retains the roots and their resources. It is not
a reversible Undo removal or a scene-resource finalizer. `await api.dispose()`
uses that same drain then performs the existing complete producer-owned cleanup.
The caller must not combine complete Stone disposal with a second generic tree
disposal. The separate host-owned tree/finalizer agreement remains with the
application owners; this slice supplies its stop/drain boundary, not that join.

Coordinates remain material-local. Picking transforms the world ray through the
material root; floor contact uses a world horizontal plane transformed into that
frame. Placement translation remains supported. Gravity requires an upright
material frame; physical scaling and arbitrary physical rotation are not
implemented. `api.placement` records these limits. The floor visual remains a
separate world root, not a child moved with the specimen. There is no general
scene collision or self-contact claim.

The current `stone/fracture` owner contribution and derived Workbench consumer
continue using the default viewport participation. Registration, authored
serialization, Undo retention, and depth/normal/GI conformance on current main
remain consumer integration work, not consequences of constructing these roots.
