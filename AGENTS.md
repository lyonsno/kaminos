# Kaminos Agent Guidance

## Start Visual Work In The Shared Workbench

For work understood by viewing, manipulating or comparing a scene over time,
use a Workbench experiment as its development and operator-facing surface.
Examples include simulation, materials, rendering, animation, interactive
geometry and generated-asset comparisons. Read
[`docs/workbench-common-main.md`](docs/workbench-common-main.md) first and inspect
the closest existing contribution. Extend a suitable experiment or add an
owner-authored `*.experiment.mjs` in `experiments/`.

Compose with the existing scene, camera, inspector, controls and applicable
capture/recording tools. Feature modules own domain behavior and meaningful
operations; the experiment connects them to both human controls and agent calls.
The guide's executable material study supplies a small starting point.

Build friendly human-facing interactions around Kaminos objects, scene editing
and contextual tools by default. Put object properties in the relevant inspector,
use ordinary selection/placement and shared camera/playback controls, and expose
meaningful feature operations through the same agent-callable path. Keep the
visible UI focused on what the person is manipulating; avoid a panel of bespoke
buttons for every script step, fixed value or named test case.

Fixtures are useful when a controlled setup is part of the experiment. Keep that
setup explicit and give its controls a clear purpose. When one-off machinery
reaches the operator, usually make the small extra investment that lets them
choose a target, adjust a meaningful parameter, navigate and repeat the action
without another code edit. Preserve those choices through the applicable shared
state/recording flow. Generalize the useful interaction, proportionately to the
work, rather than building a new framework or leaving fixture rails as the
human's only interface. See the guide's interaction guidance.

For straightforward asset inspection, use the existing asset viewer. For
authored scene changes, use the scene-authoring flow. Computational changes use
focused tests and their existing visual consumer where relevant. When task fit
is uncertain, ask the operator before choosing the development surface: describe
what needs to be observed or manipulated, recommend a route, and name the
uncertainty. Resolve ordinary API questions through source and current owners.
An unavailable shared capability is an integration question: identify the
concrete missing operation and coordinate a reusable extension with its owner.

## Feature Branch Ancestry

Before editing on a feature branch, fetch `origin/main` and record the chosen
base ref, merge-base, and `git rev-list --left-right --count origin/main...HEAD`.
Branches based on an unmerged feature are valid when they need that dependency,
but name the dependency and owner and keep the branch visibly stacked. At the
first consumer-accepted smoke or implementation handoff, compare against the
current `origin/main` again and choose explicitly: port/land the owned slice on
current main, or carry the named stack with its integration owner and next
checkpoint. Recheck before adding another dependent slice. This catches a
branch that is becoming a second product line while its dependency remains
unintegrated.

## Tests

Before a handoff, run the tests you touched with `npm test -- --only tests/a.mjs,tests/b.mjs`. Before landing, run the full `npm test`; it must report no new failures. `npm test` may end with warnings, for example missing Python packages; they never fail the run and print their remedy. Declare the kind of each new test file on its first line, for example `// kaminos-test: node`, instead of editing the shared manifest. Prefer behavior tests over regular-expression assertions on `index.html` source. Details: `docs/testing.md`.

Many worktrees link `node_modules` to one shared install. Never run `npm ci` or `npm install` through such a link or in the worktree it points to: it empties or changes the install for every linked worktree. For your own install, `unlink node_modules`, then `npm ci`.

Landing does not go through `node tools/land.mjs` for now: main has no required check, and the `tests` workflow runs on pushes to main as advisory only: test results and setup failures appear as warnings, and nothing fails the run or blocks anything. When landing is authorized, rebase on current `origin/main`, run the full `npm test` (no new failures), and fast-forward main as before. A CI gate returns only after a pilot shows lanes pass it without added overhead. Details: `docs/landing.md`.

## Retiring Surfaces

Do not build on these; put new work where the successor lives.

- **The Pipeline tab and its graph** (dock, generator library, graph workbench, run shelf, `pipeline-ui-witness.mjs`) are removed. Generation UI belongs in the Generate tab. The server routes `/api/pipeline-manifest` and `/api/run-pipeline`, `pipelines/asset-pipelines.json`, `pipeline-witness.mjs` and the `pipeline-runs` browse root stay so the Generate tab can host routes such as TRELLIS image-to-mesh; until it does, they are callable headlessly only.

## Fire Basins In Cooperative Inference Smokes

When using an exported fire basin with the WebGPU inference kit, read
`docs/basin-presets-for-inference-smokes.md`. It owns the import/mount recipe,
effective-look checks, and distinction between preset loading, shared-device
binding, and cooperative frame scheduling. Preserve the supplied basin instead
of substituting the generic fire route or a different renderer.

## Long-Running Smokes

- Treat agent wakeups as compute, not as a free process monitor. Do not put the
  model in a repeated short polling loop when the running job cannot benefit
  from intervention.
- Give each long-running smoke one durable supervisor. The smoke must write a
  terminal report on success or failure, including the failure phase and last
  trustworthy evidence when it exits before its primary artifact.
- Record requested and effective route, backend, model, kernel, and material
  configuration identity in the report whenever routing or fallback can alter
  the result. Missing, stale, partial, blank, fallback, or cached output must
  fail loud instead of looking authoritative.
- Prefer completion events and meaningful phase transitions over periodic
  model wakeups. A lightweight watcher may inspect process liveness and report
  state, but it should wake the owning agent only for terminal completion,
  failure, a phase transition that permits useful work, or a measured liveness
  anomaly.
- When event delivery is unavailable, choose a coarse recheck interval from
  observed phase duration and the earliest point where intervention could
  matter. Multi-minute GPU jobs should not produce ten-second or thirty-second
  model patrols merely to rediscover that they are still running.
- Continue independent work while the smoke runs when another safe slice is
  available. Do not recursively create polling shells, nested wait sessions,
  or status probes whose only result is another poll decision.
- Keep exhaustive parity and reference-oracle routes as offline acceptance
  gates. Interactive inference and operator workbenches should share the
  accepted runtime kernels while excluding CPU oracles, reference tensors, and
  proof-only readbacks from the serving path.

## Talking With The Person At The Page

Use Kaminos notes to discuss work with the person at the page. Resolve incoming
references and inspect their attached context; answer in the same thread. When
participating in a Workbench session, establish notes reachability through the
supported integration. See [docs/notes.md](docs/notes.md) for setup, delivery
behavior, and recovery.
