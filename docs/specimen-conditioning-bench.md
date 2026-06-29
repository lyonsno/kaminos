# Specimen Conditioning Bench

The specimen conditioning bench is the central Kaminos flow for early asset
becoming. It is not a prompt box, a Photoshop clone, a pure generator UI, or a
scene editor. It is a constraint workbench wrapped around slow hallucination
routes.

The bench exists because prompt-only asset search loses too much source truth.
The operator often knows the object law before the generator does: no visible
eyes, this silhouette, this belly groove, this terrain contact patch, this
material range, this route failed because it installed a face. Kaminos should
let the operator author those constraints directly, keep them inspectable, and
send them through routes that return evidence rather than miracles.

The current north star:

```text
one specimen gets smarter after a bad route pass
```

That means a single specimen should move through the loop:

```text
source evidence
-> truth layers
-> route request
-> route run
-> candidate, partial output, or failure report
-> operator failure tag or salvage decision
-> stronger next request
```

The packet must preserve identity and source truth at every step.

## Fast Truth And Slow Beauty

The bench splits work into two tempos.

Fast truth is the operator-controlled specimen state. It should feel immediate:
primitive geometry, masks, silhouettes, depth, normals, region locks, material
swatches, scribbles, paint hints, collage references, and negative law. This is
where the operator states what the object is allowed to be.

Slow beauty is route output. It may come from local WebGPU inference, hosted
generation, image-to-splat routes, mesh generation, material generation, or
other backends. It can be useful, surprising, or wrong. It must arrive as
evidence beside the work, not as an interruption that replaces the specimen's
law.

The operator should not have to wait for a slow route in order to keep shaping
the fast truth layer. Route results should land in a tray with route identity,
status, source warnings, and enough witness data to decide whether to salvage,
retry, tag failure, or promote.

## Specimen Packet

The current bench packet is `kaminos.kiln.specimen-packet-cockpit.v0`.

It binds:

- specimen identity: kind, first-vertical role, checkpoint id;
- source artifacts: imported, fixture, fallback, generated, or local outputs;
- truth layers: beauty, depth, normal, silhouette, mask, pointmap, and later
  other conditioning layers;
- region law: zones such as a sacred no-face cap, carry contact region, or
  terrain contact patch;
- negative law: constraints such as `no_visible_eyes`, `no_mouth`, or
  `do_not_install_face`;
- route requests: what the operator asked a route to attempt;
- route runs: what actually ran, on which backend, with which status;
- candidate artifacts: route outputs that propose asset appearance or form;
- failure tags: operator-visible reasons a route output violated the specimen;
- activity states: kiln/run state for each route;
- lineage receipts: route, backend, runtime, fallback, warning, and report
  identity;
- source-truth warnings: compact flags that keep weak or partial evidence from
  looking stronger than it is.

The packet is an evidence surface. It should not imply that a fixture primitive
is live sculpt truth, that a fallback is the requested route, that a partial
ImageData output has final artifact custody, or that a failed route produced a
usable candidate.

## Failure Cartography

Kaminos should map model failure as a first-class input.

When a route installs eyes, drifts into mascot styling, loses a silhouette,
breaks pose law, changes limb count, or returns unusable topology, the operator
should tag the failure on the packet. That tag is not just a note. It produces
stronger next-request law.

Example:

```text
failure tag: added_face
negative law patch: no_visible_eyes, no_mouth, do_not_install_face
```

The next request should carry that law forward with source truth. This is how a
specimen gets smarter after a bad pass.

## Result Tray

The result tray should show route attempts as evidence rows, not as generic
history clutter.

Each route row should make these distinctions visible:

- requested route versus effective route;
- backend class;
- fixture, request-only, live, partial, failed, fallback, or promoted state;
- candidate output versus truth-layer output versus failure report;
- source warnings;
- receipt/report identity.

The tray should stay subordinate to the specimen packet. The operator's main
question is not "what happened in the system history?" It is "what did this
route teach this specimen, and what should happen next?"

## Kiln Activity

Kiln activity is the visible process layer for the bench. It should make route
cadence readable without weakening source truth.

A specimen source tile may preheat when selected for a route, burn during live
compute, bank while outputs settle, glow when cached evidence is recalled, and
snuff when the route fails. Those states must come from route receipts and
activity state, not from optimistic UI inference.

The same packet should be able to say:

- this SHARP route failed and produced a timeout report;
- this MoGE route produced partial WebGPU truth layers;
- this fixture route proved the UI contract but did not run live compute;
- this fallback produced an output that is not the requested route;
- this candidate is promotable only after an explicit promotion decision.

The fire/smoke language belongs beside the route evidence. It should help the
operator understand which specimen is being worked, what route is spending, and
how strong the resulting evidence is.

## Promotion Boundary

A specimen packet can contain strong evidence without containing a promoted
asset.

These are different states:

- an imported source image;
- a fixture primitive;
- a truth layer such as depth or normal;
- a route request;
- a route failure report;
- a partial local WebGPU output;
- a candidate concept artifact;
- a splat, mesh, material, or scene-native promoted asset.

Kaminos should make it cheap to move useful evidence forward, but it must not
collapse these states. Promotion should be explicit, inspectable, and backed by
the correct receipt.

## Current Implementation Surface

The first specimen bench implementation lives in the Composition Tray and
Specimen Packet cockpit. It currently demonstrates:

- fixture specimen loading;
- failure tagging;
- stronger next request law;
- route activity payloads for compact fire/status rendering;
- fixture, fallback, failed, partial, cached, unavailable, and live visual
  authority classes;
- graph API route report ingestion;
- timeout/failure report custody;
- MoGE-shaped local WebGPU depth/normal/pointmap truth-layer receipt binding.

Current boundary: the MoGE route is bound as a receipt and packet truth-layer
contract. Kaminos does not yet execute the live MoGE worker internally in this
branch.
