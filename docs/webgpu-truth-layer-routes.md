# WebGPU Truth-Layer Routes

Kaminos should use local WebGPU inference as a way to produce fast, operator-
controlled truth layers beside the specimen, not only as a way to generate final
assets.

The first target route is:

```text
moge.depth-normal.webgpu-local.v0
```

This route consumes a source image and produces depth, normal, and pointmap
evidence. Those outputs are valuable because they can condition later image,
splat, mesh, material, and scene-native routes with stronger spatial law than a
prompt alone.

## Why Truth Layers Matter

Image generators are weak at obeying certain object laws from text alone. They
may install unwanted eyes, change topology, drift into mascot styling, lose the
silhouette, or ignore terrain/contact logic.

Truth layers make those constraints physical:

- depth says what is near and far;
- normals say how surfaces face;
- pointmaps say where image-space matter wants to live in space;
- masks say what region can change;
- silhouettes say what outline must be preserved;
- region law says what areas are sacred, mutable, or functional.

The generator or downstream route is no longer asked to imagine the whole
object from language. It is asked to interpret an object with already-authored
law.

## Current MoGE Contract

The current imported WebGPU inference kit defines MoGE route receipts with
schema:

```text
kaminos.webgpu-route-receipt.v0
```

For MoGE, the receipt should preserve:

- `requestedRouteId`;
- `effectiveRouteId`;
- backend kind such as `webgpu-local`;
- browser/runtime identity;
- adapter and feature facts when available;
- model id, revision, weights hash, and dtype when available;
- kernel/profile/kit identity;
- source image artifact id and shape;
- output roles: `depth`, `normal`, `pointmap`;
- output artifact ids, shapes, hashes when present;
- output status such as `partial`;
- timings.

Current Kaminos branch boundary: the specimen packet can bind MoGE-shaped
receipts and outputs into the bench, but it does not yet execute the live MoGE
worker inside Kaminos.

## Packet Binding

MoGE outputs bind into `kaminos.kiln.specimen-packet-cockpit.v0` as truth
layers.

Expected binding:

```text
depth:
  packetBindingRole: truth-layer
  viewKind: depth
  conditioningRoles: depth_source

normal:
  packetBindingRole: truth-layer
  viewKind: normal
  conditioningRoles: normal_source

pointmap:
  packetBindingRole: truth-layer
  viewKind: pointmap
  conditioningRoles: pointmap_source
```

They should enter packet lineage as WebGPU route receipts and contribute source
warnings when custody is partial.

They should not enter `candidateArtifacts` unless a later explicit promotion or
conversion route turns them into a candidate asset.

## Local Route Status

Local WebGPU does not automatically mean strong final truth.

Useful states include:

- route available but not executed;
- browser device unavailable;
- fixture receipt;
- live route execution;
- partial output;
- hash-authoritative artifact output;
- promoted truth layer;
- failed route report.

The UI should show these states directly. A local route that only produced
partial anonymous ImageData should look useful but incomplete. It should not
look like a final asset.

## Near-Term Route Families

MoGE is only the first truth-layer route. The same pattern should cover:

- segmentation routes for masks and region proposals;
- edge, scribble, or line routes for operator sketch guidance;
- matting routes for foreground custody;
- normal/depth refiners;
- local inpaint or repaint routes;
- texture/material hint routes;
- image-to-splat and image-to-mesh routes that consume the truth stack.

Every route should use the same source-truth discipline: requested route,
effective route, backend class, output role, warnings, and promotion boundary.

## WebGPU As Product Shape

WebGPU matters because it can turn the kiln from a queue-only system into a
responsive bench.

The desired cadence:

- instant: clay/specimen geometry, masks, silhouette, simple materials;
- short local pass: segmentation, depth, normal, pointmap, texture hints;
- longer local or hosted pass: image generation, splat generation, mesh or
  material generation;
- batch pass: promoted high-quality artifacts.

Local WebGPU truth-layer routes should occupy the short local pass. They should
help the operator keep shaping rather than make the operator wait for a whole
new asset attempt.

In kiln activity terms, local WebGPU truth-layer routes are allowed to show real
heat when they are actually executing locally. Their outputs should cool as
truth layers, not as finished concept artifacts. If the route produces partial
anonymous ImageData, the visual language should remain ember/partial until
artifact custody becomes stronger.

## Acceptance For Live Binding

When Kaminos executes the live MoGE worker internally, the acceptance surface
should prove:

- the browser has a real WebGPU device or fails loudly;
- the MoGE model/kernel identity is recorded;
- the route consumes the selected source image;
- depth, normal, and pointmap outputs have artifact ids and shapes;
- partial outputs carry partial warnings;
- packet truth layers update without creating candidate artifacts;
- the UI shows `webgpu-local` route identity;
- witness JSON and screenshot agree;
- no fallback or fixture receipt masquerades as live local inference.
