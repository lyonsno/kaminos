# Kaminos

> Kaminos builds the live experience that reveals what the product is, who
> needs to own it, and where its value lives before it meets the world.

Kaminos is a browser-native spatial workbench and world kiln, and the working
surface of a technical invention studio. It turns difficult product bets across AI, graphics,
simulation, spatial computing, and creative tooling into live experiences that
people can see, steer, and decide around.

The repository is where that method becomes software: local-first WebGPU
material systems, generated spatial assets, motion and world substrates,
inspectable inference routes, and the workbench that lets them meet.

##  Live Browser Combustion

Kaminos currently carries a multi-field volumetric fire and smoke simulation
that runs directly in the browser through WebGPU. Its current boundary-fire
renderer derives compact structural fields around the combustion front, then
uses those fields to guide where the volumetric renderer spends work.

The result is a live material process with:

- dynamic fire and smoke at interactive cadence;
- a `128^3` simulation route developed on Apple Silicon;
- combustion-front topology and baked boundary-sidecar fields;
- support, coverage, ridge, proximity, and footprint guidance;
- adaptive raymarch and explicit quality controls;
- route, backend, effective-control, and performance receipts;
- durable state capture and replay for visual investigation.

The fire began as an answer to a product question: how can a local AI
experience remain alive while expensive inference occupies the machine? It is
now becoming a material and rendering research program of its own.

## The World Kiln

Kaminos treats generated outputs as world matter with lineage and behavior.
Images, meshes, splats, motion, material fields, simulation state, and route
outputs enter a shared browser workbench where they can be inspected,
conditioned, transformed, staged, and handed onward.

Current substrate includes:

- Three.js/WebGPU scene editing and persistence;
- source-aware splat import, correction, crop, orientation, and sidecars;
- mesh/splat hybrid rendering and scene-context integration;
- motion-generation and motion-transposition experiments;
- browser-native fluid, particle, and material processes;
- world/chamber contracts for generated environments and inhabitants;
- route receipts that distinguish requested and effective execution;
- smoke and witness harnesses for visual and technical evidence.

The architecture is documented in [Spatial Asset Kiln](docs/spatial-asset-kiln.md).
Splat lineage and correction contracts are documented in
[Splat Assets](docs/splat-assets.md).

## From Source To Cast

The product direction is a complete visible loop:

```text
source -> route -> live work -> generated matter -> inspectable cast
```

A team should be able to choose a source, fire a real local route, remain
inside a living workroom while compute runs, and inspect the resulting object
without crossing into a disconnected tool or dead waiting screen.

This loop is being assembled from the same browser-native systems already used
for volumetric fire, splats, generated assets, motion, route scheduling, and
scene inspection.

## Decision Artifacts

Kaminos projects are organized around one expensive uncertainty. The goal is a
live artifact that makes the next product decision obvious enough to fund,
staff, transfer, continue, or kill.

The recurring engineering move is to find the missing representation that
makes the system tractable. In the current fire route, combustion-front and
boundary fields turn an expensive volumetric search into guided rendering. In
generated-world routes, the corresponding representation may be a depth or
normal field, splat, mesh, semantic substrate, motion packet, route receipt, or
world-state contract.

The visible experience carries the idea. The accompanying implementation,
tests, route identity, performance evidence, and handoff notes make it usable
after the demonstration ends.

## Run Locally

Kaminos is developed as a local browser application. Serve the checkout:

```sh
python3 serve.py 8095
```

Open the current volume route in a WebGPU-capable Chromium browser:

```text
http://127.0.0.1:8095/?kaminos_volume_smoke=1&volume_scene=tall_plume
```

The strongest current route is developed and witnessed on Apple Silicon. Other
WebGPU devices may expose different performance and feature boundaries.

## Status

Kaminos is an active research and product prototype. Internal contracts,
control surfaces, and route integrations are evolving quickly. Publicly useful
subsystems are being separated into focused packages and upstream contributions
as their interfaces settle.

For technical or collaboration inquiries, contact
[Noah Lyons](https://github.com/lyonsno).
