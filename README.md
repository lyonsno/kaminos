# Kaminos

Kaminos is a browser-native spatial forge for generated worlds, assets,
materials, motion, and living work. It gives route outputs and world-state
fragments a place to take shape with lineage, spatial context, visible process,
and operator-smokable evidence.

Kaminos has two connected public faces:

- **Spatial forge and workbench:** a place for technical makers and agent coding
  lanes to compose advanced graphics, inference routes, material processes,
  dynamic interactions, witnesses, and smoke offers in one inspectable browser
  scene.
- **World cartridge terrarium:** a taste-first surface where a world pack can
  carry creatures, terrains, behaviors, generation basins, interaction recipes,
  and example scenes that a person can play with, grow, remix, and deepen into
  maker workflows.

The current prototype includes realtime volumetric fire and smoke running
directly in the browser. The fire volume supports a tunable tall-plume scene,
spatial pressure tiers, live route controls, and debug overlays that expose
backend identity, effective parameters, and route receipts. The fire volume is
the first substrate for making compute, cache, fixture, fallback, and failure
states visible as different material phases.

The broader architecture is documented in [Spatial Asset Kiln](docs/spatial-asset-kiln.md).
[World Cartridges](docs/world-cartridges.md) defines the cartridge/terrarium
surface and its graduation modes. [Smoke Workbench For Agents](docs/smoke-workbench-for-agents.md)
describes the agent composition workflow.

## Spatial Asset Kiln

Creative inference has an awkward rhythm: the operator forms a hypothesis about
a generator, commits an experiment, then waits during the exact moment when
curiosity is sharpest. Kaminos turns that wait into visible material
transformation.

Route work should feel like an artifact entering a kiln. A source tile can
preheat while inputs and backends prepare, burn while live compute spends, bank
while outputs settle, cool once artifacts are linked, glow when cached work is
recalled, and snuff when a route fails. The visual state carries the work:
source artifacts, requested and effective routes, backend identity, output
slots, failure phase, cache status, fixture status, and fallback status stay
inspectable beside the flame.

This kiln language is a product target as well as an interface contract. Live
compute earns full burn. Cached work earns residual warmth. Fixture and
fallback routes carry weaker heat. Failure has its own collapse. The creative
loop gains texture for inference latency, route truth gains a body, and every
visible phase says something real about the work being done.

## World Chambers, Benches, And Cartridges

Kaminos organizes spatial work into chambers, benches, and cartridges:

- **World Chambers** frame a coherent world, route, or generated space with its
  own identity.
- **Workbench/Kiln surfaces** stage, condition, inspect, and promote artifacts
  and route outputs.
- **Preview Benches** give source-owned payloads a Kaminos-hosted inspection
  surface while the source lane keeps its domain law.
- **Smoke Offers** give the operator a route, authority, freshness, downgrade
  state, and target bench for a smokeable piece of work.
- **World Cartridges** bundle a playable or inspectable world seed: creatures,
  terrain, behavior presets, generation recipes, example scenes, affordance
  bindings, and graduation notes.

This keeps spatial work from collapsing into a pile of one-off tabs. A terrain
route, splat correction, material bake, motion preview, creature terrarium, or
future world-state packet can enter Kaminos with its own shape and lineage, then
become inspectable in a shared spatial frame.

## World Cartridges

A world cartridge is a portable world seed for Kaminos. It can define a
terrarium, example world, creature ecology, interaction basin, or generative
playground. A cartridge can carry assets, scene recipes, behavior presets,
generation routes, source-law bridges, capture scenarios, and graduation
accounting.

The first worked cartridge direction is a LERMS terrarium: a Kaminos-hosted
world pack for little bodies, terrain, motion, hand surfaces, and creature
experiments. The LERMS game can develop its own runtime, loop, and domain-native
systems while the Kaminos cartridge remains a forge-side terrarium and worked
example. Shared discoveries can graduate deliberately into the game repo,
Kaminos affordances, shared runtime packages, a Kaminos-backed product shell, or
archived prototypes.

World cartridges give Kaminos a taste-first entry point. A person can begin with
selection, play, growth, mutation, and interaction, then gradually reach deeper
maker handles: route receipts, generation basins, behavior graphs, agent
composition, source bridges, and witness capture.

## Volumetric Fire

The landed fire volume is the first backend substrate for the kiln language. It
already renders high-fidelity dancing flame and smoke in-browser through WebGPU,
with pressure-tier controls that can spend more solver work in visually
important flame bands and less in background smoke.

The roadmap turns it into scene-placeable primitives, route-activity adapters,
transparent tile compositing, cached/fixture/fallback visual authority classes,
banking/coals, failure snuff, and heat/color envelopes driven by real Kaminos
route lifecycle state.

## Asset Lineage

Kaminos keeps generated work inspectable after it leaves the model call.
Corrected splat assets already follow this pattern: Kaminos stores editor-side
correction sidecars beside original assets. See [Splat Assets](docs/splat-assets.md).

## Local Smoke

Serve the checkout and open the volume smoke route:

```sh
python3 serve.py 8095
```

```text
http://127.0.0.1:8095/?kaminos_volume_smoke=1&volume_scene=tall_plume
```
