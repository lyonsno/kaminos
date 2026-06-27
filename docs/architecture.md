# Kaminos Architecture

Kaminos is a spatial asset forge for assets that are generated, corrected,
conditioned, and eventually inhabited inside operational work. The central design
pressure is not "make a prettier generator UI." The pressure is to keep asset
becoming inspectable: every candidate should carry where it came from, what
constraints shaped it, which parts are trusted, and which parts are still only
proposal.

The public North Star has three layers:

1. **Forge Floor:** an inhabited operational workbench where agents, stations,
   assets, jobs, and status become visible presences.
2. **World Chambers:** named world contexts that can be visited, inspected, and
   linked back to their source routes.
3. **Specimen Bench / Kiln:** a conditioning surface where rough spatial truth
   and slow generative output meet without confusing either one for the other.

## Current Substrate

The repo already contains several substrate pieces that point at this shape:

- Greenroom and receipt-backed asset intake.
- Splat asset discovery, correction sidecars, pivot/crop controls, and explicit
  render-handoff limits.
- Scene persistence for objects and volume primitives.
- Motion and volume witness contracts.
- Browser/server smokes that preserve route identity and fail when a witness
  would imply more authority than the evidence supports.

These are not yet the whole Kaminos product. They are the working substrate for
the forge.

## Forge Floor

The Forge Floor is the operational work surface. Its job is to make durable work
visible as places, stations, actors, artifacts, and status instead of scattered
logs. In public terms, this means Kaminos should be able to show:

- what asset or world is being worked;
- which route or witness produced the current evidence;
- which jobs are running, blocked, stale, or complete;
- which artifact is selected and what source it claims;
- where generated candidates, failures, and corrections live.

The Forge Floor should not become the source of truth merely because it is
visible. It is an operational view over explicit data contracts.

## World Chambers

World Chambers are named visitable contexts for assets and simulations. A chamber
may represent a game world, a project scene, a generated environment, or a
bounded witness space. The chamber contract should keep source-honest receipts
near the view:

- chamber id and title;
- source route and receipt identity;
- fixture/live authority;
- freshness or timestamp fields when available;
- summary counts for important occupants or events;
- explicit absence rows for systems that are not live yet.

This lets a chamber show a fixture-shaped world without pretending it is a live
simulation. A fixture can be useful substrate as long as the interface says it is
a fixture.

## Specimen Bench / Kiln

The Specimen Bench is the asset-becoming interface. It is where an operator
conditions a specimen before, during, and after model generation. The **spatial
asset kiln** is the slower route that produces candidates from that conditioning
stack.

The bench should preserve a split between **fast truth** and **slow beauty**.

Fast truth is the local, inspectable material the operator can edit and trust
quickly:

- primitive mass, silhouette, and scale;
- depth, normals, masks, and region labels;
- sacred regions that should not change;
- mutable regions that may be explored;
- negative law such as "no eyes here" or "do not add hands";
- references, crops, and source-honest receipts.

Slow beauty is candidate output from heavier routes:

- image, mesh, splat, material, or texture variants;
- style and lighting explorations;
- generated thumbnails;
- higher quality batches;
- route-specific failure probes.

Slow outputs belong beside the work, not on top of it. They should be candidates
with provenance, not silent replacements for the conditioning stack.

## Failure Cartography

Failure cartography means treating model mistakes as useful spatial evidence.
When a route keeps adding the wrong anatomy, erasing a required silhouette,
violating a mask, or drifting away from a reference, Kaminos should make that
failure nameable and reusable.

Examples of reusable failure evidence include:

- a locked no-face mask;
- an attention-nub region that may carry sensing cues without becoming eyes;
- a topology ridge that blocks a recurring hallucinated feature;
- rejected crops that show exactly what went wrong;
- downgrade reasons attached to a candidate receipt.

This keeps iteration concrete. The operator is not only saying "try again." The
bench is building a map of what the route must stop doing.

## Preview Ladder

The preview ladder keeps the interface responsive while slower routes work:

- instant primitive, depth, normal, silhouette, mask, and material-swatch
  feedback;
- sub-second cheap stylization or tiny preview routes;
- seconds-scale conditioned thumbnail batches from a locked camera and
  conditioning stack;
- longer mesh, splat, material, or image candidates;
- high-quality batches that may take minutes and should return with explicit
  route receipts.

The operator should be able to keep editing while the kiln runs. Completed
outputs should land in a tray with source, route, and authority visible.

## Source-Honesty Rules

Kaminos should keep generated assets from becoming more authoritative than their
evidence. The core rules are:

- generated assets become inspectable candidates, not final truth by default;
- receipts should name requested route, effective route, source inputs, and
  authority;
- fixture/live authority must be visible wherever a witness is shown;
- stale, missing, partial, fallback, or malformed evidence should fail loud;
- render handoff, simulation status, and source truth are separate contracts;
- promoting a candidate should preserve its provenance and downgrade history.

This is the reason Kaminos docs and witnesses should prefer source-honest
receipts over screenshots alone. A screenshot can prove that something rendered;
it does not by itself prove where the asset came from or what authority it has.
