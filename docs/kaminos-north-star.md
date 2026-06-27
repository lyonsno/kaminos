# Kaminos North Star

Kaminos is a spatial creation environment for building, inspecting, staging, and
eventually inhabiting generated worlds.

The useful public phrase is not "asset viewer" and not "agent dashboard." Those
are both smaller than the thing. Kaminos is a meta-place: a forge where world
pieces are made, a workbench where they are tested, and a set of chambers where
finished or half-finished worlds can be entered on their own terms.

The current architecture has three primary spatial modes:

- **Forge Floor:** the operational habitat where embodied workers, tools,
  stations, processes, and long-running work become persistent spatial
  presences.
- **Workbench / Kiln:** the making surface where assets, materials, splats,
  terrain fields, simulations, receipts, and prototypes are inspected and
  transformed.
- **World Chambers:** visitable worlds with their own local ontology, camera
  posture, interaction laws, debug surfaces, and transition membranes back to
  the forge.

The point is not to bury everything under a generic editor shell. The point is
to let each artifact move through different pressures: isolated inspection,
bench staging, world-local testing, and full inhabitation.

## Why This Shape

Generated assets become much more useful when they can be moved between context
levels without losing identity.

A mesh, splat, material, terrain field, actor, or simulation object may need to
be:

- examined alone on a bench;
- placed into a small test rig;
- composed with other world pieces;
- witnessed under a route that records source and fallback truth;
- entered as part of a living scene;
- handed back to the forge with enough provenance that future work knows what
  was actually built.

That is the core Kaminos loop:

1. Build or import a thing.
2. Inspect it honestly.
3. Stage it in a constrained environment.
4. Let it participate in a world.
5. Preserve enough route truth and spatial memory that the work remains
   recoverable.

The same object should not become a different identity every time the operator
switches views. A thing on the bench and a thing in the world are the same
thing under different posture.

## Spatial Modes

### Forge Floor

The Forge Floor is the home surface for persistent operational context. It is
where work has stations instead of disappearing into terminal tabs, process
lists, or disconnected debug pages.

The first version may be simple: visible actors, station groups, labels,
selection metadata, source markers, and inspector panels. The deeper direction
is a living workshop where long-running work can be recognized by place, body,
light, motion, residue, and the artifacts accumulating around it.

The Forge Floor should stay available while the operator is inside another
world, but it should not visually flatten that world into a dashboard. A world
may expose a small forge rail, listening tube, station aperture, status balcony,
or other bridge object. The bridge should preserve the local chamber's fiction
and visual language while still allowing operational return.

### Workbench / Kiln

The Workbench is where generated matter is made tractable.

This includes:

- material and texture inspection;
- splat, mesh, and hybrid representation work;
- terrain and volume prototypes;
- lighting and environment staging;
- generated asset receipts;
- transform and grouping;
- witness routes that prove what actually rendered or simulated.

The Workbench does not need to feel like a final world. It should feel like a
capable studio surface: dense, precise, reversible, and honest about source
truth.

### World Chambers

A World Chamber is a visitable world inside Kaminos. It is not just a tab with a
preview canvas. It is a place that gets to have its own rules.

Each chamber should define:

- what kind of world it is;
- what counts as an actor, object, terrain, input, and event;
- which workbench artifacts can be staged there;
- how the operator enters, inspects, plays, edits, or witnesses it;
- how the forge remains reachable without dominating the chamber;
- what route truth must be recorded for claims made by the chamber.

World Chambers let Kaminos support multiple strange worlds without forcing them
all through one neutral presentation. A chamber can be a game space, a terrarium,
an industrial test bay, a dreamlike asset garden, a motion stage, or a hostile
debug theater. What makes it a Kaminos chamber is not shared genre. It is shared
provenance, staging, inspection, and return to the forge.

## Postures

Kaminos should distinguish posture from identity.

The same artifact can appear in several postures:

- **Inspect:** isolated object, material, transform, receipt, route identity,
  and witness truth.
- **Stage:** object placed in a constrained bench or chamber-local rig.
- **Inhabit:** object participates in the full world chamber under that
  chamber's rules.
- **Forge:** object or world is understood through its operational production
  context: who built it, which route produced it, which witnesses proved it,
  which station owns the next move.

This is a cleaner model than multiplying tabs for every use. The operator does
not merely open a different page. The operator changes how much world-pressure
the object is under.

## Worked Example: LERMS

LERMS is a useful first worked example because it is not naturally reducible to
a generic asset preview.

The LERMS world ontology is built around:

- Underhill as the interpretive frame;
- the Hill of Hills as breathing terrain;
- glove wealth and goins as thick portable desire;
- lerms as opportunistic terrain vermin with economic consequences;
- finger juice as action-without-touch;
- theft, dropped wealth, rerouting, and ecology mutation as the playable spine.

In a flat editor, this becomes a bad tab: "LERMS." In Kaminos, it wants several
connected places:

- **Underhill:** an entry and study layer, not just a menu. It can hold
  ledgers, maps, a listening tube, a terrarium, and other world-local control
  surfaces.
- **Terrarium:** a small constrained behavior harness where lerms, goins,
  terrain, and fluids can misbehave without needing the full game field.
- **Hill of Hills:** the live playable chamber where lerms climb, steal, get
  interrupted, drop goins, and reroute.
- **Workbench surfaces:** benches for lerm bodies, goin materials, terrain
  fields, finger-fluid emitters, and witness receipts.
- **Forge bridge:** a diegetic or semi-diegetic route back to the Forge Floor
  when the operator needs to inspect the process, source route, or worker that
  produced a piece of the world.

The design lesson is broader than LERMS. A chamber should preserve its world
meaning while staying connected to Kaminos' making and witnessing substrate.

For LERMS, the listening tube can carry forge status. A wet ledger can expose
route truth. A terrarium can become the first behavior smoke. A suspicious hatch
can return the operator to the forge. The world stays weird; the system stays
usable.

## Forge Rail

When the operator is inside a World Chamber, the Forge Floor should remain
reachable through a compact persistent affordance: a forge rail.

The forge rail is not a second full dashboard pasted over the world. It is a
small presence layer that can show:

- important active workers or processes;
- source/fallback/stale status;
- pending reports or blocked routes;
- selection and return affordances;
- enough identity that the operator knows where to go next.

Different chambers can render the rail differently. In an industrial chamber it
may be a gantry. In LERMS it may be a listening tube, bad ledger, hatch gauge,
or green-glass aperture. The contract is functional continuity, not visual
uniformity.

## Source Truth

Visual output in Kaminos is contract-bearing.

Any view that claims to show a live asset, live route, live simulation, or live
worker state must preserve source identity. If the chamber is showing fixture,
fallback, stale, seeded, projected, or visual-only data, it should say so in a
way the operator can inspect.

This matters more as Kaminos becomes more immersive. A beautiful world that lies
about where its data came from is worse than a crude bench with honest receipts.

World Chambers should therefore report:

- effective route/config identity;
- live, fixture, fallback, stale, seeded, projected, or visual-only status;
- relevant input freshness;
- witness artifacts when a behavior or render claim matters;
- enough object identity to round-trip between world, bench, and forge.

## Public Story Boundary

Kaminos can be explained publicly without requiring every private ambition to
be public on day one.

The public-legible core is:

> Kaminos is a spatial studio for generated worlds: build assets on the bench,
> stage them in controlled rigs, enter world chambers, and preserve the
> provenance and witness truth needed to keep generated work usable.

That story is coherent now.

The inhabited Forge Floor is also part of the north star, but it should be
promoted carefully. Without working prototypes, "embodied operational workers"
can sound like an unrelated agent-dashboard pitch bolted onto an asset tool. The
right order is:

1. show asset inspection and staging;
2. show a world chamber that preserves local ontology;
3. show source-honest witnesses and round-tripping between bench and chamber;
4. show persistent forge actors as the natural way the operator manages the
   work that produces those worlds.

In other words, do not hide the Forge Floor from the architecture. Do not lead
with it as the public proof until the prototype makes it feel inevitable.

## First Coherent Slice

The first slice that expresses this north star does not need to be huge.

It should create:

- a top-level `World Chambers` surface;
- a first chamber entry for LERMS / Underhill;
- a small Underhill or Terrarium scene that can host one constrained behavior
  witness;
- a way to move an artifact between Workbench and chamber posture;
- a compact forge rail or placeholder bridge that proves the Forge Floor remains
  reachable without taking over the chamber;
- route truth in the witness output.

That would show the real Kaminos shape: not a generic 3D viewer, not a game
launcher, not an agent dashboard, but a spatial forge where generated matter,
world logic, witnesses, and operational presence can meet without collapsing
into one flat interface.
