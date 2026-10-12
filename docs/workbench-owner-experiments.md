# Owner-Authored Workbench Experiments

Owners build experiments in their Kaminos worktree using shared host operations
and their own domain modules. A contribution file ends in `.experiment.mjs` and
lives under `workbench-experiments/` by default. It is trusted local executable
code. The application and agent callers consume the same definition.

The initial common modules are `workbench-experiments.mjs` and
`workbench_experiments.py`. Application discovery, chooser placement and host
capability wiring are the current integration step. The example below describes
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
