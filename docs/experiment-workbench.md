# Composing and inspecting experiments

Start with a short ordinary JavaScript scene program. Kaminos supplies the renderer, camera, authoring controls, history and scene persistence. The CPU planner gives you bounds views to inspect before launching the renderer. The experiment then uses the same edits and saves that a person uses in the editor.

## Compose a scene

`examples/experiments/two-emitters.mjs` composes two water sources and a static marker. `examples/experiments/static-scene.mjs` composes ordinary procedural meshes. Both return the native `.kaminos.json` document, which you can extend with existing scene records and settings.

```js
import { scene, mesh, water } from './experiment-scene.mjs';
export default scene([
  water('source', { position: [0, .4, -1.65] }),
  mesh('marker', 'box', { position: [-1, .5, 0] }),
]);
```

Run from your Kaminos worktree after `npm ci`:

```sh
node experiment-plan.mjs \
  --example examples/experiments/two-emitters.mjs \
  --scene /absolute/path/to/scenes/water.kaminos.json \
  --out /absolute/path/to/layout
```

The output includes `layout.svg`, `views.json`, `inputs.json` and `plan.json`. The SVG projects authored geometry bounds and labeled regions on the CPU. Water is represented by its emitter handles; the real liquid host computes the evolving water. The static marker supplies visual context; water contact uses the host's analytical basin. Inspect the view sheet and choose useful cameras for the actual phenomenon.

An example can export `layoutOptions` with `assetBounds` keyed by object ID and `regions` containing `{id,min,max}` in world space. Asset bounds are local to each asset and transformed through its persisted world pose; groups retain their role as editing frames. Caller-supplied bounds retain that representation label. Procedural meshes derive bounds from their actual constructors. The planner requests bounds explicitly for other object families. `viewOptions` chooses directions, aspect and field of view; all views and regions remain caller-controlled. Camera aspect in the running editor follows the actual viewport; saved observations include that effective lens.

## Investigate the scene

For the complete first water run, choose your own `WORK` directory and a free port. Use the same paths in planning, serving and observation. `PLAYWRIGHT` points to the installed module's `index.mjs`; `CHROMIUM` points to an independent Chromium or Chrome for Testing executable.

```sh
node experiment-plan.mjs --example examples/experiments/two-emitters.mjs \
  --scene "$WORK/scenes/water.kaminos.json" --out "$WORK/layout"

KAMINOS_SCENES_DIR="$WORK/scenes" KAMINOS_ASSETS_DIR="$WORK/assets" \
  python3 serve.py 8206 --volume-settings-store "$WORK/basins" \
  --volume-basin-session-store "$WORK/basin-sessions" \
  --volume-cockpit-layout-store "$WORK/layouts"
```

Keep the server running and invoke the experiment from another shell in the same worktree:

```sh
node visual-work-run.mjs --origin http://127.0.0.1:8206 --repo "$PWD" \
  --scene water.kaminos.json --scenes "$WORK/scenes" --basins "$WORK/basins" \
  --example examples/experiments/water-study.mjs --inputs "$WORK/layout/inputs.json" \
  --out "$WORK/water-observations" --playwright "$PLAYWRIGHT" --browser "$CHROMIUM"
```

Start `serve.py` with your isolated stores, then use the existing [visual-work runner](repeatable-visual-work.md). Supply `--example examples/experiments/water-study.mjs` and `--inputs /absolute/path/to/inputs.json`:

```json
{
  "views": "/absolute/path/to/layout/views.json",
  "seconds": [1, 3],
  "viewNames": ["front", "three-quarter"]
}
```

That experiment starts water held at step zero, moves one source using the shared pose editor, and observes both cameras at each specified simulation time. From the resulting observation it identifies the source whose position changed and builds a closer view around that source, preserving the same held simulation moment. It then freshly reopens the saved authored scene. The other source retains its pose. Use `static-study.mjs` for the static scene; it exercises edit, observation and reopen through the same modules.

Write your own experiment with independently usable operations:

```js
import { experiment, pausedWaterUrl } from './experiment-work.mjs';
export const configureUrl = pausedWaterUrl;
export default async function (context) {
  const work = experiment(context);
  await work.water.hold();
  await work.pose('source', { position: [.2, .4, -1.65] });
  await work.water.advanceTo(1);
  await work.camera(context.inputs.camera);
  const seen = await work.observe('one-second', { water: true });
  // Use seen.observed to choose your next view or feature operation.
  return { handoff: seen.url };
}
```

The script can use custom JavaScript and feature APIs between observations. Static work can use `pose`, `camera` and `observe` independently of water. The runner owns browser lifetime; `experiment()` also accepts an existing page/retention context for callers with their own session lifetime.

## Time and continuation

The local-water clock reports a run ID, submitted and GPU-completed steps, fixed step duration, completed seconds, pause state and failure. `hold()` pauses and drains submitted GPU work. `advanceTo(seconds)` advances a held run to a forward, fixed-step-aligned time, checking that the actual solver accepted its substeps. Render frames have a separate counter. Multiple camera observations can share one held state. Unsupported rewind reports the need to reopen/replay the authored setup.

Observations pair effective camera, objects, water/source generation and clock with a PNG and saved editable scene. A changed runtime, source, pose or camera during capture fails the experiment. `report.json` carries its last retained observations and failure; launch and planning failures also leave reports at the supplied output path.

A saved scene restores authored inputs and starts a fresh water runtime. The observation records the former run's moment. Opening the handoff URL lets a person edit and save that setup with the ordinary controls. The next experiment can take the saved filename as its input. Liquid-state checkpoint restoration, arbitrary mesh collision, feature registration for new object types, and coordinated multi-simulation clocks are future extensions with their own runtime adapters.

## Use an existing runtime

An existing experiment supplies four operations once for its runtime:

```js
const runtime = {
  settle,       // await pending physical work and the corresponding presentation
  read,         // return current source, run, time, camera and feature state
  camera,       // apply a view and await its presentation; return effective camera
  assertStable, // compare before/after capture; throw if the inspected state changed
};
```

These are ordinary caller functions, including closures over Playwright or a CDP connection. `read()` uses the feature's own state structure. An optional `validate(state, options)` checks each read before comparison; otherwise the reader checks its own held-state prerequisites. `assertStable(before, after, options)` compares the meaningful source, run, configuration, completed time, camera and physical state. Presentation counters may increase while held. Preserve construction-load time offsets and reset identities. The feature owns the actual stepping, forces and investigation decisions.

For a caller with an existing browser runner, `observationSession` supplies image/state retention:

```js
import { experiment } from './experiment-work.mjs';
import { observationSession } from './observation-session.mjs';
import { viewsAround } from './experiment-scene.mjs';

await observationSession({
  out: outputDirectory,
  source: verifiedSource, // caller's effective checkout, route and configuration
  capture: () => page.screenshot({ type: 'png' }),
  exercise: async ({ retain }) => {
    const work = experiment({ runtime, retain });
    await stone.hold();
    await stone.pull(.03);
    await stone.advance(30);
    const bounds = await stone.currentBounds();
    const views = viewsAround(bounds, { aspect: 16 / 9 });
    for (const view of views) {
      await work.camera(view);
      await work.observe(view.name);
    }
  },
});
```

Here `stone`, `runtime` and `verifiedSource` come from the consumer's existing feature. The shared modules own view planning, capture retention and the observation sequence; the feature owns injury and current bounds. Browser lifetime stays with the caller. Use `visualWork` when the editable-scene save/reopen path is part of the experiment.

`capture()` returns fresh PNG bytes from the caller's actual browser or canvas. The caller verifies the effective route and GPU/backend at the appropriate feature boundary. Shared retention checks image structure and nonuniform pixels; the runtime checks state consistency. These checks support inspection, while the operator or agent still inspects the images for the phenomenon in question.

Choose a fresh output directory per session. `report.json` records source, each observation's full effective state, image path/hash/dimensions, failure phase and last verified observation. A failed or changing capture retains its raw output as unverified; a caught retention error still fails the session. Existing reports and repeated observation names are protected from overwrite. A runtime/setup failure inside `exercise` leaves its report even before the first image. Include route verification and startup inside `exercise` when those failures need the same report.

An existing custom `retain` can also be used. It receives `{name, observe, verify}`: call `observe()` immediately before capture, then `verify()` afterward, and only then publish the observation as successful. The default workbench retention implements that sequence. `experiment` requires post-capture verification; incomplete retention fails explicitly. Water callers keep `experiment({page, retain})` and `{water:true}` unchanged.
