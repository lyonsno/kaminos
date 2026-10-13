# Owner-Authored Workbench Experiments

Owners build experiments in their Kaminos worktree using shared host operations
and their own domain modules. A contribution file ends in `.experiment.mjs` and
lives under `workbench-experiments/` by default. It is trusted local executable
code. The application and agent callers consume the same definition.

The common modules are `workbench-experiments.mjs` and
`workbench_experiments.py`. The application composition below supplies discovery,
the chooser and actual Fluid capabilities. The example below describes
the callable interface; its `host.water` methods are illustrative capability
injection, to be bound to the actual fluid owner's operations.

```js
export default {
  id: 'paper/finite-water',
  title: 'Finite water',
  async create({host, inputs, record}) {
    const water = await host.water.open(inputs);
    return {
      read: () => water.read(),
      operations: {
        async pressure(patch) {
          const result = await water.pressure(patch);
          record({kind: 'paper.pressure', target: water.id,
            phase: 'applied', requested: patch, effective: result});
          return result;
        },
      },
      mount({invoke, read, ...view}) {
        return host.controls.mountPressure({view, read,
          apply: patch => invoke('pressure', patch)});
      },
      dispose: () => water.close(),
    };
  },
};
```

`create` receives the actual host capability object, caller inputs and explicit
operation recording. The owner validates its own units, configuration and
domain semantics. Importing definitions should expose metadata and functions;
runtime allocation belongs in `create`. `read` returns the owner's state;
operations retain their owner-defined arguments and results. Record requested,
pending, applied and failed phases at their actual domain boundaries using the
existing investigation operation shape. Recording is inactive without a
subscriber. Full state is read only when requested.

`mount` is optional and receives the same `invoke(name, input)` and `read()` used
by agents, plus host-supplied view context. It returns the owner's UI handle.
Owner `dispose` releases the instance's resources and mounted subscriptions;
the common wrapper makes disposal idempotent. The host owns switching,
completion of in-flight domain operations, and any resources shared across
instances. A failed `create` cleans up its own partial allocation.

## Discovery And Invocation

Hotwet's server can import
`discover_experiments(explicit_checkout_root, directory)` and expose its URL
list through the existing application server. Discovery rescans the supplied
directory, so adding another contribution needs no list edit. The directory is
inside the served checkout; source files and private input data have distinct
custody. Retained camera data should use the appropriate local evidence route.

```sh
python3 workbench_experiments.py --repo-root "$PWD"
```

The browser imports the returned URLs and mounts the selected contribution:

```js
import {loadExperimentContributions, openExperiment} from './workbench-experiments.mjs';
const definitions = await loadExperimentContributions(moduleUrls);
const definition = definitions.find(item => item.id === selectedId);
const current = await openExperiment(definition, {host, inputs});
await current.mount(viewContext);
await current.invoke('pressure', patch);
```

Agent code can use the same interface through its existing page attachment, or
import a definition with an appropriate headless host. Module loading is
injectable for Node/filesystem consumers. Existing application access, capture,
retention and recording remain independent tools. This layer provides module
entry and invocation; the persistent investigation-link service remains a
separate integration.

Paper's first consumer supplies river and finite-water operations; the hand
consumer supplies source-aligned recorded mesh playback, shared orbit and
inspectable unavailable intervals. Their actual producer adapters and native
consumer exercises establish host compatibility. Common fixture tests only
establish discovery, invocation and recording behavior. The useful next proof
is an owner's initial contribution and follow-up using the same host without
another central application edit.


## Application host composition on the current feature

`serve.py` exposes `/api/workbench-experiments` using the served checkout root.
It scans `experiments/` by default; `KAMINOS_EXPERIMENTS_DIR` selects another
contribution directory inside that checkout. The Workbench's Experiment
selector discovers the owner definitions. Refresh finds additional files;
a page reload executes edits to an already imported file. Opening a definition
is explicit, and switching definitions disposes the prior instance.
The ordinary URL preserves `experiment=<id>` and JSON `experiment_inputs`.
These inputs reconstruct a setup after reload, not evolved GPU water.

The initial actual Fluid host capability is `host.fluid.open(setup)` with
`setup={solver,dt,support,sampling,guide}` from the numerical owner. Supported
support kinds are `analytical` and `invisible_box`; finite setup supplies its
real diagnostic population and box. The shared host currently supports
`screen_space_refraction` rendering; `host.fluid.rendererModes` exposes that
boundary, and another requested renderer fails explicitly. An owner wrapper
can select that mode for shared use while preserving its standalone debug
viewer. The present solver step contract accepts frame dt from 1/240 through
1/30 seconds. The same timestep governs initial controls, exact advance and
host clock; no second device, camera or frame pump is created.

The returned water capability supplies `read`, `getSolver` (pressure/debug
read facade), `applyPressure`, `setPaused`, `advanceTo`, `restart` and
`dispose`. It is bound to that owner's water allocation; stale disposal
cannot destroy replacement water. Explicit shared reset remains within that
owner's instance and changes the reported runtime generation. Pressure edits
use existing requested/effective receipts and recording. A finite fixture's
particle count derives from its setup rather than the general count control.

`mount({root,document,invoke,read})` receives a left instrument root.
`host.controls` supplies the document and shared `installNumberDrag` helper.
Owner-specific UI can invoke its named operations directly; agents use
`window.kaminosWorkbenchExperiments.invoke(name,input)` on the same instance.
The application API also exposes `list`, `refresh`, `open`, `read`, `state`
and `close`. Import/open errors appear in the selector status; startup errors
retain the last host error. The current generic entry does not itself implement
persistent investigation documents or live cross-page return.

Reopening the same definition and input JSON reconstructs the existing cockpit
pressure settings URL, including a general river population edit. Changing the
definition or inputs starts from that owner's new setup. The capability keeps
ownership fixed across an asynchronous restart; the optional allocation-generation
variant needs an explicit renewal receipt if its generation changes. The host
reports both configured frame dt and effective substep dt, using the actual
backend substep count; exact advances reject incomplete-frame targets before
stepping. This preserves configuration, not an evolved-water checkpoint.

## Shared mesh loader join

The application exposes `await window.kaminosWorkbenchLoadAsset(file, options)`
for the shared scene-session adapter. It waits for the existing viewport to
initialize, appends through the ordinary GLB loader, and registers the actual
object for selection and inspection. Its result is
`{id, root, clips, source, fileName, arrival}`. `root` and `clips` are the objects
returned by the GLTF loader; owner playback binds to those same objects.
Ordinary imports retain their existing root-only result.

The adapter forces append and registration even if callers supply clear or
preview options. Existing arrival placement remains available; `normalize:false`
or `arrival:null` preserves source coordinates when the producer needs them.
An owner supplies `isCurrent()` to reject a late load after its session closes.
The existing stale-load path disposes that loaded object before registration.
This loader join does not supply experiment frame subscriptions, removal or
capture/replay lifetime. Those belong to the shared scene-session composition,
which consumes this hook rather than creating another scene or renderer.
