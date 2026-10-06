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
