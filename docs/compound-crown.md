# Compound Crown mechanism study

Open `?experiment=compound-crown&workspace=workbench` on a Kaminos server. The
experiment attaches one selectable apparatus to the current scene. Select it to
find Iris opening, Vane drive, repetition counts and playback rate in Properties.
The normal object gizmo changes its pose. Reopen this setup carries the current
recipe and object transform in the experiment URL; it does not add an authored
scene-object persistence adapter.

The lower register solves an intersection of two circles for each repeated
crank endpoint. The crank and connecting rod retain their lengths as the common
unison ring turns. The upper iris uses repeated rigid leaves with fixed pivots.
Each follower's path, expressed in the turning ring's frame, defines its cam slot.
The two drives are independent. This is a kinematic construction, with no gas law
or collision solver attached. The reported clear radius is the largest centered
circle unobstructed by the leaf polygons.

`experiments/compound-crown/mechanism.mjs` supplies deterministic `crownRecipe`,
`evaluateCrown`, `leafDefinition` and `irisCamPoint`. Geometry and material live in
`view.mjs`. The experiment adapter owns the shared scene/session, contextual
Properties and application-frame subscription. It exposes the same edits to an
agent:

```js
await window.kaminosWorkbenchExperiments.invoke('set', {opening: 0.8, swirl: -0.4});
const state = await window.kaminosWorkbenchExperiments.read();
```

A recipe is a plain object with `opening` (0–1), `swirl` (-1–1), `vaneCount` and
`irisCount` (integers of at least three), nonnegative `rate` in cycles/second and
boolean `playing`. Family count edits rebuild geometry on the same registered
root. These are exploratory geometry controls; arbitrary counts are not a claim
of collision-free or manufacturable assemblies. New generated surfaces can use
these named part families while preserving the mechanism's body frames.

Numeric edits apply live through the shared drag/click/type installer. Domain
changes are recorded as effective experiment operations. Native transform edits
use scene history; domain recipe edits do not yet contribute Undo entries to that
ledger. The next integration is ordinary burner/source ownership and persistent
assembly parameters with the burner editor consumer.
