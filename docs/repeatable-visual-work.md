# Repeatable visual work

Use an authored `.kaminos.json` scene as the shared editable input. A JavaScript example opens it in Kaminos, applies edits through the normal editor operations, and retains a picture with its saved scene. The resulting URL opens that exact version for a person to continue editing. Feed their saved filename into the next run to continue from their work.

## First run

Start `serve.py` from your feature worktree with your scene, generated-mesh and basin stores mounted. The scene refers to those mounted assets. Install Playwright in your tooling environment and supply its module path plus an independent Chromium or Chrome for Testing executable.

```sh
node visual-work-run.mjs \
  --origin http://127.0.0.1:8194 --repo "$PWD" \
  --scene your-scene.kaminos.json \
  --scenes /absolute/path/to/scenes --basins /absolute/path/to/basins \
  --out /absolute/path/to/this-comparison \
  --example examples/visual-work/pose-comparison.mjs \
  --playwright /absolute/path/to/playwright-core/index.mjs \
  --browser /absolute/path/to/independent/chromium
```

The pose example moves the selected object +0.25 along X, checks the other objects and camera, exercises undo, and freshly reopens the second saved version. Optional `--inputs file.json` supplies `{ "objectId": "your-object", "deltaX": 0.25 }`. Use a separate output directory for each comparison you want to keep. `a.png` and `b.png` accompany the saved documents; `report.json` contains their exact server filenames and editable URLs, effective server/store identity, feature observations and any failure. `launch.json` records the executable and startup failures. The runner closes its own browser after the exercise; your server continues serving the handoff.

## Cheap Execution And Escalation

The command-line entry defaults to a 640 x 480 preview output and an Authoring
workspace. Before loading content it saves a separate execution scene with
preview viewport quality, standalone GTAO mode with AO disabled, and depth of
field disabled. The caller's original file remains intact. This baseline serves
placement, framing and ordinary interaction comparisons. Lighting, material
quality and fine-detail questions can require the authored settings.

Pass `--output-profile settings.json` with settings from
`window.kaminosRenderOutput.read()` or a named output preset's `settings` field.
The same Render & Output validator and capture implementation serve the runner.
For a larger image, full quality, or the original scene's presentation, supply
`--cost-reason "the specific observation requiring these settings"`. A reason
preserves the authored scene settings; the output profile still controls picture
dimensions and output quality. Every run records the reason, effective output,
renderer identity and the source-to-execution scene filenames. This is an
explicit execution override, so reconsider the job's runtime estimate with it.

Saved fluid/fire simulation setups require a cost reason before loading. Their
owner chooses solver resolution, steps and particle counts for the question;
this presentation preset leaves physics intact. A cheap image alone says
nothing about solver cost. Supply `--workspace workbench` when that workspace is
part of the intended interaction. Existing callers of `visualWork()` retain
their existing behavior; passing `execution:{}` selects this same cheap path,
and `execution:{output,reason}` selects an explicit profile/exception.

In this path PNG bytes live once in each observation's `.png`; the editable
scene and report reference that observation without embedding another copy of
the picture. Retained state describes authored settings. A feature's hold and
state continuation operations determine whether a dynamic observation can be
reproduced at the same evolved instant.

## Independent Cases And The Queue

An existing Python Greenroom producer can call `run_visual_cases` from
`visual_work_batch.py` with `cases=[{id:'case-name',args:[...runner arguments]}]`,
`repo_root`, the `node` executable, an invoker-owned `out`, and its existing
`continuation(checkpoint)` and `on_submitted(request)` callbacks. Install/use the
producer's Greenroom Python environment. The helper assigns a separate output
directory per case and invokes the same command-line runner. Each case completes
and closes its browser before the queue's `gpu_queue.cooperative.run_units`
boundary acknowledges it. The queue retains the cursor and result references;
the successor starts the next case. An interrupted case keeps its output and
requires a new output directory for a fresh attempt.

The continuation callback constructs a same-owner/repo/route request; the
registration callback establishes its existing completion delivery before queue
publication. Estimates/history for the original workload are cleared on the
successor because the remaining case set differs. Cases remain finite independent
experiments; evolved-world resumption belongs to the domain's state API. The
shared machine continues to use Greenroom's exclusive GPU slot.

For qualifying jobs, submit the ordinary producer command through
`gpu-greenroom submit-command` with `--cooperative-checkpoint` when using this
helper. Use `--expected-seconds` and optional `--runtime-reason` when a rough
whole-command estimate is available, including startup and cleanup. Greenroom
owns Quick admission and fairness. The estimate creates neither a timeout nor a
concurrency allowance. A normal small local page check can still run directly.

`examples/visual-work/water-pose.mjs` uses the same pose exercise with a feature-owned water wait and in-run pause. `examples/visual-work/flame-light.mjs` changes fire light gain through the parameter API and captures a live field. Its images compare authored lighting with evolving flame; a controlled frozen-field experiment supplies its own hold operation. Reopening these scenes restores their authored settings and starts the dynamics again.

## Your feature

An example is an ordinary module exporting an async function. It receives `page` (Playwright), the input `document`, `inputs`, output path `out`, and two convenience functions:

```js
export default async function ({ page, retain, open }) {
  await page.evaluate(() => window.kaminosSetSceneObjectTransform('chair', {
    position: [0.25, 0, 0],
  }));
  const result = await retain({
    name: 'moved',
    settle: async page => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    },
    observe: page => page.evaluate(() => window.kaminosSceneObjectDebugState()),
  });
  await open(result.filename);
  return { handoff: { filename: result.filename, url: result.url } };
}
```

Feature code chooses operations, settling or holding, effective-state assertions and the comparison question. `retain({name, capture:false})` saves an editable version when an image is unnecessary. Existing [scene operations](scene-authoring-operations.md) supply pose, parameters, history and flame recipes. Feature persistence stays in the scene's existing typed adapters. `visualWork()` is independently importable for callers that already own a browser; the command-line runner adds browser lifetime and argument handling.

Opening verifies the served checkout, requested stores when supplied, requested scene route, and each saved object's ID, type, source and pose. Retention checks the actual server document against the save response and checks PNG extent and pixel variation. Feature assertions and human inspection establish whether the pictured behavior answers the comparison question.

## Save results from the mounted editor

`await window.saveScene({result:true})`, `saveSceneAs({result:true})` and `captureComposition({result:true})` return `{ok:true, filename, url, document}` for their own invocation. The document contains the JSON submitted to the normal save endpoint, including capture pixels when requested. Failures return `{ok:false, error}`. Existing calls with no options retain their boolean result. Human buttons and scripted calls use the same save operations.

For handoff, open the returned URL, change the scene, and use Save or Save As. The status bar names the saved filename. The next agent invocation takes that filename with `--scene`; its input is the person's accepted edits. Asset and basin mounts remain part of the running server, so keep them available alongside the document.
