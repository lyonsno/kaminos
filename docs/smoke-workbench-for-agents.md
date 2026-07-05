# Smoke Workbench For Agents

Kaminos is the smoke-making toolkit, not a passive validator for demos built
somewhere else.

If you are an agent producing visual, spatial, world-state, motion, material,
asset, or interaction evidence for the operator to inspect, your job is not to
send a lane-local page and hope the operator can compare it by memory. Your job
is to use Kaminos as the bench where the smoke is assembled, viewed, captured,
witnessed, and routed back into the work.

## The Happy Path

Build toward this flow:

1. Bring source law, source state, or generated artifacts from your lane.
2. Mount them on a Kaminos bench, native host, chamber, or viewer.
3. Preserve source schema, route, authority, freshness, downgrades, and custody.
4. Exercise the same operator route the operator will click.
5. Capture visual witness evidence from that route.
6. Publish or advertise the Smoke Offer only after the route is smokeable in
   Kaminos.

Do not send the operator a lane-local demo as the smoke. A local demo can be a
debug surface or source reference, but it is not the normal acceptance surface
for Kaminos smoke. A report summary, JSON card, screenshot by itself, iframe
placeholder, or link-out button is not the smoke either.

The smoke is the operator-visible route in Kaminos, with the source evidence and
camera/capture context still attached.

## What You Bring

Bring the smallest source-owned thing that lets Kaminos render or inspect the
work without stealing your domain law.

Good inputs include:

- a live packet endpoint,
- a file-backed packet or payload,
- a generated asset path,
- a source-owned primitive list,
- a scene or motion state record,
- a route receipt plus output artifacts,
- a small adapter that maps your source state into Kaminos-visible primitives.

You own the source semantics: physics, model meaning, behavior truth, world law,
freshness claims, and fixture/fallback state. Kaminos owns the smoke apparatus:
bench placement, host display, camera, visible badges, capture, witness, and the
operator route.

## What Kaminos Provides

Use Kaminos as a workbench while you build:

- the WebGPU scene/viewer,
- native host surfaces,
- Preview Bench routes,
- World Chamber routes,
- asset and splat viewers,
- camera and inspection controls,
- source/freshness/downgrade badges,
- screenshot and filmstrip capture,
- browser witnesses,
- Forge Host / station Smoke Offers.

If the thing you need is almost a route Kaminos already has, extend the route or
adapter instead of making another detached demo. If Kaminos lacks a necessary
host surface, name the gap and build the smallest host surface that makes the
operator route real.

## Current Manual Path

Until the full Smoke Workbench tooling exists, use this manual sequence.

1. Pick a Kaminos host shape.

   Use a native host when Kaminos should draw source-owned primitives directly.
   Use a Preview Bench when the source payload is evidence to inspect before it
   becomes an inhabited chamber or native surface. Use an asset route when the
   thing is a GLB, PLY, SPZ, image, sidecar, scene, or material artifact that
   Kaminos can already load.

2. Produce source state for that host.

   The source state must include schema, route, source ref, source authority,
   freshness or sample age, fixture/fallback/stale downgrades, and rejected
   debug surfaces where relevant.

3. Open the Kaminos route yourself.

   Use the actual operator route, not a nearby report page. If you expect the
   operator to click a Forge Host Smoke Offer, test that offer path too.

4. Run or add a visual witness.

   The witness should capture the operator route and report route identity,
   source identity, visible state, and screenshot or filmstrip artifacts. It
   should fail if the route is blank, proxy-only, report-only, or opens out to a
   lane-local demo as the acceptance surface.

5. Publish the Smoke Offer.

   Only advertise the smoke once the Kaminos route is the easy route. Keep
   direct links to lane-local pages as debug escapes, visibly secondary.

## Minimum Deliverable

Before you tell the operator or another lane that a smoke is available, have
these in hand:

- the Kaminos operator route,
- the source schema and route on screen or in witness state,
- the source authority and freshness/downgrade state,
- the source-owned payload, endpoint, or artifact reference,
- the Kaminos host/viewer/bench identity,
- a visual witness report against the operator route,
- a screenshot or filmstrip artifact,
- a clear note naming any remaining downgrade.

If you only have a conformance report or source packet, say that. It may be
useful progress, but it is not operator smoke acceptance.

## Tooling Target

The intended tooling should make the above path boring. The target shape is a
Kaminos Smoke Workbench command or UI that can:

```text
kaminos smoke workbench <name>
  --adapter <kaminos-adapter-or-host>
  --source-url <live-or-local-source-endpoint>
  --source-path <optional-file-payload>
  --station <producer-station-or-diaulos>
```

That future tool should create or update the smoke workspace, mount the route,
run the relevant witness, capture evidence, and register the Smoke Offer. Agents
should not have to hand-author the whole Kaminos contract to use the bench.

Until that exists, compose toward it:

- keep your source adapter thin,
- make the Kaminos route primary,
- keep debug links secondary,
- test the same route the operator will click,
- route failures as missing Kaminos tooling or missing source state, not as an
  invitation to send a detached demo.

## Worked Example: Glove Well

For a Glove Well-style native host, the source lane should provide the live host
packet or packet file, such as a `lerms.glove-well-host-packet.v0` source. The
Kaminos path should mount that packet in the Glove Well native host, show source
authority/freshness/downgrades, and produce a visual witness from the Kaminos
route.

A conformance fixture that proves `adapter: glove-well` and required primitive
roles is useful, but it is only an intermediate check. The operator smoke is not
complete until the Glove Well route opens inside Kaminos and the visual witness
captures the native host surface.

## Worked Example: Single Asset Links

For a single visual asset such as an image, GLB/mesh, PLY, SPZ, or sidecar-backed
scene object, do not send a raw file URL as the smoke. Use or build a first-class
Kaminos asset route that requests the asset, mounts it into the viewer, records
requested and effective route identity, and registers the loaded object in
debug/witness state.

For example, the intended GLB-style shape is a route like:

```text
?mesh_root=greenroom&mesh_path=<relative-output.glb>
```

The visual witness should prove the browser requested the asset, the scene
registered a non-empty object, the operator route stayed in Kaminos, and the
capture shows the loaded asset. An empty Kaminos app shell, screenshot-only
handoff, or raw `/api/read` link is not enough.

## Quick Self-Check

Before handing off a smoke, ask:

- Would the operator stay in Kaminos when following the normal path?
- Is the primary route the route I actually witnessed?
- Can another agent find the source schema, route, authority, and freshness?
- Is any local demo clearly marked as debug-only?
- Did Kaminos capture a screenshot or filmstrip from the operator route?
- If this failed, would the report name the phase and last trustworthy evidence?

If the answer to the first two questions is no, build the Kaminos route first.
