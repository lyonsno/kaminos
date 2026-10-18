# Retained starting setups

Keep in Setup carries selected discoveries from the live scene into a retained
starting document. The inspector offers meaningful groups supplied by the owner:
emitter placement/emission/domain placement, or creature placement/behavior/source
choices/current location. Opening the proposal freezes its observation. Keeping
it edits the starting document while the current scene continues.

Starting setup contains download, begin-again and setup undo/redo actions.
Loaded scenes establish the starting document; **Use current as setup** establishes
or replaces it explicitly. Existing scene Save and creature Save keep their
current live/continuation behavior. This first implementation keeps its setup in
memory until downloaded; reopening the downloaded file uses the ordinary loader.

## Owner integration

`retained-setup.mjs` owns revision checks, cloned observations, atomic replacement
and setup history. The owner supplies validation, observation and projection:

```js
const setup = createRetainedSetup({document: initialRecipe, validate});
const proposal = setup.prepare({observe, project});
const candidate = proposal.preview({placement: true, behavior: false});
proposal.commit({placement: true, behavior: false});
const saved = setup.read().document;
```

`project({baseline, observed, choices, describeOnly})` returns `{document, groups, dependencies}`.
With `describeOnly:true` it returns the groups before validating their selection,
so a user can correct an invalid default combination in the dialog.
Each group has `id`, `label`, `checked` and optional `detail`. Projection and
validation throw on unsupported references or inconsistent combinations. The
caller can revise choices against the same observation; changing the starting
revision requires a new proposal. Documents retain their owner's existing format.

`mountRetainedSetupControls` renders these operations through injected `read`,
`remember`, `prepare`, `undo`, `redo`, `save` and `begin` callbacks. Owners preflight
their ordinary loader before replacing the current scene. Both UI and agent
consumers use the same store and projections.

## Current adapters

- `window.kaminosStartingSetup`: scene read/remember/prepare/undo/redo/begin;
  the emitter projection supports the current single-source fire arrangement.
  It preserves solver/material settings and recalculates pose-derived injection
  controls. A moved domain is an explicit retention choice.
- `window.kaminosWalkingSetup`: walking-creature read/remember/prepare/undo/redo.
  The experiment's ordinary `open('marionette/walking-creature', recipe)` starts
  the retained document. Start at current location rebases the initial pelvis
  pose onto the observed location and resets playback phase. Heading and scale
  follow retained placement. Living-room zones and wander journeys have their
  own owner integration ahead.

This slice retains authored starting conditions. Continued burning, field state
and evolving material require their owner's coherent continuation capability.
