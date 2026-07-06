# Smoke Workbench For Agents

Kaminos is the smoke-making toolkit for visual, spatial, world-state, motion,
material, asset, and interaction work. Agents use Kaminos as the bench where a
smoke is assembled, viewed, captured, witnessed, and routed back into the work.

## Core Workflow

Build toward this flow:

1. Open a Kaminos worktree for serious visual or spatial smoke work.
2. Choose a chamber, workbench, asset route, or world cartridge as the visible
   working surface.
3. Bring source law, source state, generated artifacts, or live endpoints from
   the source lane as dependencies.
4. Compose with Kaminos affordances: viewers, actors, stations, fire, benches,
   cameras, direct asset routes, capture, witnesses, and Smoke Offers.
5. Exercise the same operator route the operator will click.
6. Capture visual witness evidence from that route.
7. Record the promotion or graduation mode.
8. Publish or advertise the Smoke Offer once the Kaminos route is smokeable.

The smoke is the operator-visible route in Kaminos, with source evidence,
camera/capture context, and graduation accounting attached.

## What You Bring

Bring the smallest source-owned thing that lets Kaminos render, inspect, or
compose the work while preserving your lane's domain law.

Good inputs include:

- a live packet endpoint;
- a file-backed packet or payload;
- a generated asset path;
- a source-owned primitive list;
- a scene or motion state record;
- a route receipt plus output artifacts;
- a source module or adapter;
- a behavior/event stream from a game or world repo;
- a source bridge for a world cartridge.

You own the source semantics: physics, model meaning, behavior truth, world law,
freshness claims, and fixture/fallback state. Kaminos owns the smoke apparatus:
bench placement, host display, camera, visible badges, capture, witness,
operator route, and composition surface.

## What Kaminos Provides

Use Kaminos as a workbench while you build:

- the WebGPU scene/viewer;
- native host surfaces;
- Preview Bench routes;
- World Chamber routes;
- world cartridge and terrarium surfaces;
- asset, splat, and image viewers;
- actor/orb/station affordances;
- camera and inspection controls;
- source/freshness/downgrade badges;
- screenshot and filmstrip capture;
- browser witnesses;
- Forge Host / station Smoke Offers.

When the thing you need is close to an existing Kaminos route, extend that route
or adapter. When the source lane needs a new host surface, build the smallest
Kaminos host surface that makes the operator route real.

## World Cartridge Work

A world cartridge is a portable world seed for Kaminos. It can carry terrain,
creatures, behavior presets, generation basins, source bridges, example scenes,
affordance bindings, and witness routes. Use a cartridge when the smoke is a
world or terrarium composition with its own scene identity, creature ecology, or
interactive basin.

Cartridge work can support both:

- taste-first interaction, where a person selects, grows, mutates, farms,
  observes, and captures world inhabitants; and
- technical maker work, where an agent composes source law, generator routes,
  actors, motion, hand surfaces, fire, capture, and witnesses inside a Kaminos
  worktree.

For a LERMS terrarium, a lane might compose Hill terrain, Palm hand-surface
state, Mushfinger actor/body affordances, Molten assets, and LERMS source
behavior into one Kaminos route. The LERMS game can later port domain-native
pieces while the Kaminos cartridge keeps a forge-side terrarium.

## Current Manual Path

Until full Smoke Workbench tooling exists, use this manual sequence.

1. Pick a Kaminos host shape.

   Use a native host when Kaminos should draw source-owned primitives directly.
   Use a Preview Bench when the source payload is evidence to inspect before it
   becomes an inhabited chamber or native surface. Use an asset route when the
   thing is a GLB, PLY, SPZ, image, sidecar, scene, or material artifact that
   Kaminos can already load. Use a world cartridge when the work is a terrarium
   or world composition.

2. Produce source state for that host.

   The source state should include schema, route, source ref, source authority,
   freshness or sample age, fixture/fallback/stale downgrades, and labeled debug
   surfaces where relevant.

3. Open the Kaminos route yourself.

   Use the operator route. If you expect the operator to click a Forge Host
   Smoke Offer, test that offer path too.

4. Run or add a visual witness.

   The witness should capture the operator route and report route identity,
   source identity, visible state, and screenshot or filmstrip artifacts. It
   should record blank, proxy-only, report-only, or link-out behavior as a
   failed acceptance phase with last trustworthy evidence.

5. Record graduation mode.

   Every serious composition should choose a current mode:

   - remain in Kaminos terrarium;
   - port domain-native into the source project;
   - extract shared runtime;
   - ship a Kaminos-backed shell;
   - archive prototype evidence.

6. Publish the Smoke Offer.

   Advertise the smoke once the Kaminos route is the easy route. Keep debug
   links visibly secondary.

## Shortest Cartridge Smoke Path

For a cartridge or crucible smoke, begin at `/api/world-cartridges`. Pick the
cartridge, then the crucible, then the `smokeOffers` entry for your output. The
offer carries a computed `smokeWorkbench` card with the operator route and the
receipt loop.

The Forge Host route shape is:

```text
?kaminos_forge_host=live
  &world_chamber=<default-chamber>
  &world_cartridge=<cartridge-id>
  &world_crucible=<crucible-id>
  &forge_host_smoke_offer=<offer-id>
```

Open that route in the Kaminos worktree. The chamber should select the station,
open the offer, display authority/freshness/downgrades, and choose an inline
host when the target can be embedded. Use Screenshot or Receipt in the Smoke
Chamber to capture `kaminos.forge-host.smoke-receipt.v0`.

Return to your lane with two pieces:

- your source-owned firing, cast, route, packet, or gap report; and
- the Kaminos smoke receipt from the operator route.

Kaminos owns the route, host, capture, receipt, and operator-visible
workbench state. Your lane owns the behavior, packet, source payload, and the
claim that the domain thing works.

## Minimum Deliverable

Before you tell the operator or another lane that a smoke is available, have
these in hand:

- the Kaminos operator route;
- the source schema and route on screen or in witness state;
- the source authority and freshness/downgrade state;
- the source-owned payload, endpoint, artifact reference, or source bridge;
- the Kaminos host/viewer/bench/cartridge identity;
- a visual witness report against the operator route;
- a screenshot or filmstrip artifact;
- the current promotion or graduation mode.

Conformance reports and source packets are useful progress. Operator smoke
acceptance begins when the Kaminos route is smokeable and witnessed.

## Tooling Target

The intended tooling should make the above path boring. The target shape is a
Kaminos Smoke Workbench command or UI that can create a composition workspace,
mount source dependencies, open the route, run the relevant witness, capture
evidence, register the Smoke Offer, and write graduation accounting.

Possible command shapes:

```text
kaminos smoke workbench <name>
  --adapter <kaminos-adapter-or-host>
  --source-url <live-or-local-source-endpoint>
  --source-path <optional-file-payload>
  --station <producer-station-or-diaulos>
```

```text
kaminos world cartridge <cartridge-id>
  --scene <scene-id>
  --source-bridge <project-or-runtime-source>
  --witness <scenario>
```

Agents should compose toward those shapes:

- keep source adapters thin;
- make the Kaminos route primary;
- label debug links as debug;
- test the same route the operator will click;
- route failures as missing Kaminos tooling or missing source state.

## Worked Example: Glove Well

For a Glove Well-style native host, the source lane provides the live host
packet or packet file, such as a `lerms.glove-well-host-packet.v0` source. The
Kaminos path mounts that packet in the Glove Well native host, shows source
authority/freshness/downgrades, and produces a visual witness from the Kaminos
route.

A conformance fixture that proves `adapter: glove-well` and required primitive
roles is an intermediate check. The operator smoke completes when the Glove
Well route opens inside Kaminos and the visual witness captures the native host
surface.

## Worked Example: Single Asset Links

For a single visual asset such as an image, GLB/mesh, PLY, SPZ, or
sidecar-backed scene object, use or build a first-class Kaminos asset route that
requests the asset, mounts it into the viewer, records requested and effective
route identity, and registers the loaded object in debug/witness state.

For example, the intended GLB-style shape is a route like:

```text
?mesh_root=greenroom&mesh_path=<relative-output.glb>
```

The visual witness should prove the browser requested the asset, the scene
registered a non-empty object, the operator route stayed in Kaminos, and the
capture shows the loaded asset.

## Quick Self-Check

Before handing off a smoke, ask:

- Does the normal path keep the operator in Kaminos?
- Did I witness the primary route?
- Can another agent find the source schema, route, authority, and freshness?
- Is each debug surface labeled as debug?
- Did Kaminos capture a screenshot or filmstrip from the operator route?
- Does the report name the failure phase and last trustworthy evidence?
