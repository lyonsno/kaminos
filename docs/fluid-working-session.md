# Investigate the Same Water Twice

The Fluid working session holds the existing Fluid workbench between short JavaScript experiments. Open the bench, advance to an interesting state, inspect its image, then run another program against the same paused water. Each program uses the existing pressure controls, camera and GPU solver.

Start this checkout's server with caller-owned stores, then choose a Fluid route from the current bench. The first exercised route uses `kaminos_finger_fluid_bench=1`, `finger_fluid_pressure_solver=ipbf`, `finger_fluid_pressure_cockpit=1`, and `finger_fluid_particle_count=12288`. Its other parameters remain ordinary bench URL parameters. An omitted `finger_fluid_witness_target_step` gives the bench its existing open step horizon; a supplied target keeps its declared stop. Opening holds the first available runtime; read its actual step before choosing an absolute `advanceTo` target for comparisons.

## First Question

Supply an independent Chrome for Testing executable and an installed Playwright module. These are environment paths, supplied once at opening. `--session` names the caller-owned attachment file; `--out` names a fresh observation directory for this invocation.

```sh
node tools/fluid-session-run.mjs \
  --session "$RUN/session.json" --out "$RUN/first" \
  --url "$FLUID_URL" --repo "$PWD" \
  --browser "$CHROME_FOR_TESTING" --playwright "$PLAYWRIGHT_MODULE" \
  --exercise examples/fluid-first-question.mjs --inputs "$RUN/first-inputs.json"
```

`first-inputs.json` contains `{"steps":30}`. The example is ordinary code:

```js
export default async function ({fluid, retain, inputs}) {
  const held = await fluid.hold();
  await fluid.advanceTo(held.clock.step + inputs.steps);
  await fluid.observe(retain, 'initial');
}
```

Inspect `first/observations/initial.png`. The full observation lives beside it in `initial.state.v8`; use `readObservationSession(reportPath)` from `observation-session.mjs` to hydrate and validate the report. Camera, requested/effective controls, runtime generation, completed step, backend, diagnostics and full particle words are retained. The compact JSON index references complete binary payloads and records the Node/V8 version.

## Next Question

Write a follow-up input file after looking at the first result, for example:

```json
{"controls":{"capillaryStrength":10},"steps":30,"view":{"yaw":-0.9,"pitch":0.95,"distance":10,"target":[0,-0.48,0.2]}}
```

```sh
node tools/fluid-session-run.mjs \
  --session "$RUN/session.json" --out "$RUN/second" \
  --exercise examples/fluid-second-question.mjs --inputs "$RUN/second-inputs.json"
```

That example applies a control change, observes the pending state, advances the held simulation, captures the result, then changes the camera and captures another view. IPBF edits become effective at the next deliberate step. The attachment follows the live session through control-driven URL changes and restores the capture dimensions. A reset or replaced page requires an explicit new session.

The experiment receives `{fluid, page, retain, inputs}`. `page` permits existing feature operations alongside the shared calls. `fluid.read()`, `hold()`, `advanceTo(step)`, `apply(controls)`, `view(camera)` and `observe(retain,name)` can also be used through `bindFluidWorkingSession(page)` inside an existing browser owner. Browser launch and observation retention are separate modules; `observationSession` accepts an arbitrary caller-supplied state read, capture and verification.

## Lifetime and Interpretation

The owned browser remains alive and paused between invocations. Its session file locates that running simulation; the retained particle observations support diagnosis. Saving and restoring a GPU simulation after closing the browser remains a separate capability. Explicitly close the owned browser when finished:

```sh
node tools/fluid-session-run.mjs --session "$RUN/session.json" --out "$RUN/close" --close
```

Reattachment checks the serving checkout, source identity and stores. Revisions belong in another explicit run. Browser cleanup uses the owned endpoint identity even after source changes. Each invocation writes `run.json` from startup, including failures before primary capture. An observation marked verified establishes the recorded local checks and retained image/state; visual interpretation and physical predicates belong to the investigation. Native integration has been exercised on the IPBF Fluid workbench; PBF and isolated numerical fixtures retain their feature-owned joins.
