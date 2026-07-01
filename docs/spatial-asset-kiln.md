# Spatial Asset Kiln

Kaminos is a spatial asset kiln: a browser-native place that treats generated
assets as specimens to be staged, inspected, conditioned, witnessed, and
promoted without losing source truth.

The public frame is simple: generated assets as specimens, not thumbnails in a
feed.

The project is not trying to make a generic dashboard for model outputs. The
goal is a spatial workbench where generated artifacts, route outputs, scene
states, and world evidence keep their provenance while gaining a body the
operator can inspect. A splat, material bake, terrain packet, motion preview,
or world-state receipt should arrive with its source route and authority still
visible. Kaminos can host and witness the specimen, but it does not certify
domain truth unless the source evidence does.

## Kiln Language

Creative inference has a bad default rhythm: commit an experiment, wait while
the machine works, then inspect an output after curiosity has already cooled.
Kaminos turns that wait into visible process.

The kiln language gives route work material phases:

- **Preheat:** inputs, source refs, backends, and effective route parameters are
  being prepared.
- **Burn:** live compute is spending and the work is materially in flight.
- **Bank:** outputs are settling, linking, indexing, or waiting for inspection.
- **Cool:** artifacts are present, witnessed, and stable enough to handle.
- **Glow:** cached or recalled work remains warm enough to understand its prior
  route and authority.
- **Snuff:** failure has a visible collapse with failure phase and last
  trustworthy evidence.

These phases are interface contracts, not only animation ideas. Live compute
earns full burn. Cached work earns residual warmth. Fixture and fallback routes
carry weaker heat. Stale or visual-only evidence must look downgraded. Failure
should not resemble a successful idle state.

The realtime WebGPU fire and smoke volume is the first substrate for this
language. It gives the kiln a material vocabulary for heat, pressure, smoke,
banked coals, collapse, and route-local debug state.

## World Chambers

A **World Chamber** is a coherent place for a source-owned world, route, or
evidence space. It is the frame that lets an operator enter a world-state
surface without turning every route into an unrelated tab.

Current and near-term chambers include Underhill-style staging areas: terrain,
actor, motion, object, and interaction evidence can be inspected together as a
world-in-progress. A chamber can carry a route receipt, source refs, camera
presets, source authority, freshness, fallback state, and witness artifacts.

A chamber does not own every truth it displays. If the chamber hosts terrain
evidence from one source lane and motion evidence from another, Kaminos must
preserve those source schemas and authorities instead of renaming them into
Kaminos-owned world law.

## Workbench/Kiln Surfaces

A **Workbench/Kiln** surface is where specimens become inspectable. It is the
operational layer between raw source payloads and inhabited scene/world
presence.

That presence does not transfer custody over body semantics, embodied motion
grammar, physics, or behavior truth.

Workbench/Kiln surfaces can stage assets, condition specimens, expose route
state, show witness receipts, and prepare promotion into a chamber or scene.
They should make the operator's normal actions cheap: open the evidence, change
camera, inspect provenance, capture a screenshot or filmstrip, and route a note
back to the producer with the observed evidence attached.

This is where the kiln metaphor becomes useful rather than ornamental. A bench
can show whether a specimen is live, cached, fixture, fallback, stale, failed,
or promoted. Those states should be visible beside the specimen rather than
buried in logs.

## Human-Primary Interface Text

Every new visible bench, route, activity, offer, status row, card, alert, or
button must lead with human-readable meaning. The primary text should make
sense to someone who is not the operator and not an agent.

The evidence machinery still has to exist, but it belongs underneath the human
sentence. Receipts, schemas, warnings, false-closure checks, requested/effective
route ids, backend ids, source truth, freshness, scheduler state, and visual
source truth should live in secondary lines, tooltips, detail panels, or an
evidence drawer. They support the primary text; they are not the primary text.

For example, the main row should say something like "SHARP made a splat from
this image while the furnace dropped to a lower live burn." The supporting
detail can then say which route ran, whether the scheduler evidence was
verified, what fire budget was requested, what budget actually ran, whether the
visual source was live, and where the report lives.

When evidence is weak, the same rule applies. A row should say "The route
finished, but Kaminos could not prove the furnace stayed live during the wait"
before exposing `scheduler-unverified`, `visualSourceNotLive`, report paths, or
schema names. Plain language is not permission to weaken evidence; it is the
translation layer that keeps evidence from becoming interface jargon.

## Promotion Membrane

Promotion is a membrane, not a mood. The promotion ladder is scratch output ->
witnessed payload -> promoted take/asset/sidecar -> chamber or scene placement.
Each step should say what changed: better source, stronger witness, operator
acceptance, route correction, sidecar update, or placement into a world chamber.

Promotion does not mean the operator liked a screenshot. It means the artifact
has crossed a named boundary and kept enough route, camera, source, freshness,
and downgrade context for later work to understand why it is allowed to sit
closer to the scene.

## Preview Benches

A **Preview Bench** is an inspection posture for chamber evidence before that
evidence becomes an inhabited chamber, promoted asset, or accepted route result.

Preview Benches display source-owned payloads through Kaminos-owned host
surfaces. They are useful exactly because they keep the boundary sharp:

- Source lanes own payload schemas, semantics, domain truth, freshness claims,
  and live/fixture/fallback/stale authority.
- Kaminos owns host display, acceptance-surface validation,
  source/fallback/stale badge rendering, browser capture, and witness reports.
- Debug views, lane-local demos, and iframe bridges are rejected surfaces unless
  a source truth packet explicitly says otherwise.

The first concrete instance is the LERMS/Underhill-style terrain preview bench,
but the pattern is meant to generalize. A future material bench, splat
correction bench, motion bench, or object-interaction bench should be able to
reuse the same source-honest intake shape without inheriting LERMS-specific
world law.

## Motion And Body Custody

Kaminos can preview generated motion, store promoted motion takes, display
cliplet sheets or filmstrips, and place motion payloads into chambers. That is
host custody: spatial placement, badges, capture, camera, and witness shape.

The source adapter owns payload semantics and freshness. The worldbody and
motion layers own motion grammar, event assignment, embodied dynamics, and
behavior truth until explicit source evidence promotes a result. A LERMS actor
timeline, Mushfinger cliplet sample, or future body-motion payload can be
hosted in a chamber without becoming Kaminos-owned motion law.

For Forge stations, the same boundary holds. A station may advertise Smoke
Offers, show status, and receive operator observations; it does not thereby own
runtime commands, chat authority, body dynamics, or motion semantics.

## Smoke Offers

A **Smoke Offer** is the handoff from a producing lane, station, or future agent
orb to a smokeable inspection surface.

The offer says: this producer has something the operator can inspect; here is
the target surface, source route, source ref, payload schema, authority,
freshness, downgrades, and rejected debug surfaces. It is a station-facing
affordance, not a domain-truth claim by itself.

The current preferred contract shape is:

```text
kaminos.forge-host.smoke-offer.v0
```

Preview Benches can mount those offers through a route/state/witness layer, for
example:

```text
kaminos/preview-bench/smoke-offer-file
kaminos.preview-bench.smoke-offer-state.v0
preview-bench-smoke-offer-contract
```

The contract should not collapse `live`, `fixture`, `fallback`, and `stale`
into one vague status. Those are separate authority and freshness axes. A live
packet can become stale. A fixture can be fresh as fixture. A fallback may be
recent but still downgraded. Kaminos should show a simple badge to the operator
while keeping the underlying authority, freshness, downgrades, and display
state machine-readable.

## Operator Smoke Capture

The return path matters as much as the opening path. When an operator smokes a
specimen, Kaminos should be able to produce operator smoke capture evidence:
screenshots, filmstrips, camera identity, active route, source authority,
payload schema, timestamp, and an optional operator note.

That lets a producer receive more than a prose reaction. The reply can carry:

- the exact route the operator inspected,
- the payload and source refs on screen,
- the camera or preset used,
- the capture artifacts,
- the authority/freshness/downgrade state visible at capture time,
- and the operator's note anchored to that evidence.

This is the beginning of a shared visual conversation: the operator and the
producer can talk about the same specimen, not a memory of a smoke.

For example, a motion take can export a filmstrip with prompt, route, model,
source frame range, camera preset, reference skeleton mode, authority,
freshness, downgrade state, and the operator's note. The producer receives a
small visual object both sides can discuss instead of a terminal-only status
report.

## Source-Honesty Rules

Kaminos must make evidence more visible without making it look stronger than it
is.

Kaminos host display does not certify domain truth by itself.

Required public-facing rules:

- Preserve source schemas and routes.
- Show source authority, freshness, fixture/fallback/stale downgrades, and
  failure phase.
- Record effective route/config identity, not only requested inputs.
- Treat screenshots and filmstrips as evidence with source and camera context.
- Keep rejected debug surfaces visible so demos cannot impersonate acceptance.
- Fail loud when fallback data is shown while claiming live or seeded data.
- Do not certify domain truth from host display alone.

The same rule already applies to splat assets. Kaminos can store correction
sidecars and render editor previews, but the correction sidecar is not a new
splat file and not proof of final renderer fidelity. See
[Splat Assets](splat-assets.md) (`docs/splat-assets.md`) for that contract.

## Relationship To The Inhabited Agent Forge

The Inhabited Agent Forge is an internal and future-facing extension of this
architecture, not the public headline yet.

The long-term direction is that source lanes and diauloi can become embodied
stations in Kaminos. An operator could walk up to a station, see what it is
working on, open its Smoke Offers, inspect the specimen on a bench, capture
evidence, and route the observation back. That is powerful, but it only works
if the underlying kiln and evidence contracts are solid first.

Publicly, Kaminos should lead with the Spatial Asset Kiln: spatial workbench,
source-honest evidence, generated asset conditioning, route witnesses, chambers,
benches, and inspectable material process. The agent-forge layer can emerge as
the demo becomes coherent enough to be seen rather than explained.
