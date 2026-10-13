# Mount An Owner Investigation

`mountInvestigation` in `investigation-mount.mjs` supplies the Node-side capture,
final recording writer and page-loss lifecycle. It uses the existing
`retainInvestigationCapture` writer and `investigation.json` / `recording.v8`
layout. `mountFluidInvestigation` remains the Fluid-specific entry over it.

```js
const handle = await mountInvestigation({
  page, out, source,
  install: async ({id, binding, source}) => {
    // Mount the existing guide/recorder in this page with the owner's context.
    // UI buttons call window[binding]({action: 'capture' | 'finish', note}).
    return {
      read,        // -> {recording: recorder.snapshot(), context: ownerContext}
      finish,      // freeze recorder and UI, return the same payload shape
      disconnect,  // (message) detach/freeze the guide, preserve the live scene
      saveFailed,  // (message) expose retry of that frozen recording
      isPresent,   // -> boolean: this exact recording still inhabits this page
    };
  },
});
```

Callbacks run in Node and may use `page.evaluate` to reach their browser state.
They may return promises. The installer creates the shared browser recorder
with the supplied id/source and actual initial context/starting conditions.
It owns partial-install rollback and its own subscription cleanup. Use the
existing `createInvestigationGuide` for mounted Capture/Finish controls; the
Fluid wrapper is a complete example of browser installation and callbacks.
The mount verifies calls originate from its page's main frame.

The returned handle is `{id, capture(note), finish(note), finished, reportPath}`.
The caller owns the output directory and keeps Node attached until `finished`
settles. Capture retains a PNG, before/after reads, complete meaningful operation
prefix and note. Finish freezes the recorder once and writes the final payload;
a failed save can retry that same frozen payload. Page replacement/loss rejects
`finished` and leaves previous observations retained. Finish preserves the scene.

## Held Observations

An owner can explicitly bracket capture with its existing transaction:

```js
captureKind: 'held-source-frame',
aroundCapture: async retain => {
  const token = await creature.holdAndPresent();
  try {await retain();}
  finally {await creature.restore(token);}
},
```

`aroundCapture` receives `(retain, {note, id, source})`. Call and await `retain`
exactly once while the intended frame is actually displayed. The common mount
uses the real retention result; skipping retention fails. Hold/presentation and
restore failures mark the capture entry failed while preserving any acquired
image/context. A thrown hold must roll back its own partial mutation. Restore
must target the same owned runtime; the owner decides how to report a lost one.
The default is passive displayed-frame capture, with no implicit hold/redraw.

The owner read supplies retained reconstruction inputs alongside current state:
definition and asset/source identities, clip/frame and view for the creature.
Reopen through the existing owner entry's serialized `open(id, inputs)` so its
previous instance is disposed before reconstruction. The captured operation
prefix remains history; a new recording represents the reconstructed attempt.
Producer reconstruction and the general persistent-link service are separate
consumer joins. The common mount makes on-disk capture material available to
them; a saved scene alone carries only the state its owner actually serialized.
