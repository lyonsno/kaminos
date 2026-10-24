# Ash accumulation experiment

Open `/?workspace=workbench&experiment=ash-deposition` in the shared Workbench.
The fixture loads the existing kiln from the `generated-meshes` asset root:
`f8e6ce918e3e5cf234d186724dc21b40b3f9cf7cbc9e776000cf55f24801c91b.glb`.
The file is local shop input, not included in this repository. A missing file
or unavailable WebGPU collision route prevents mounting visibly.

Move the amber contact sphere using ordinary scene placement. **Add ash** seeds
material above that position. Amount is measured in loose cell volumes; radius
sets its horizontal spread. **Press contact** displaces material within the
specified sphere into available nearby cells. **Save ash** exports evolved
state; **Load ash** restores it into the same fixture. Ordinary scene Save does
not retain this experimental simulation state. The kiln and ground are static
collision inputs; moving either requires reopening the experiment. Reopening
starts empty unless an exported ash checkpoint is loaded.

## Representation and cost

`ash/deposit.mjs` holds fractional loose volume in sparse blocks. An explicit
active frontier settles downward and spreads supported material above a
provisional half-cell repose difference. Settled cells stop participating.
A disturbance wakes neighboring occupied cells. This is a coarse deposit model,
not calibrated granular physics. It preserves separate deposits above and below
an overhang. It does not yet model packing, compaction, airborne advection, or
continuous moving-body collision.

`ash/surface.mjs` emits only exposed cell faces. The experiment rebuilds dirty
blocks after a simulation step, not all historical material. Surfaces remain
terraced at the initial 0.06 world-unit cell spacing. Sleeping deposits incur no
ash solver or mesh-rebuild work, but visible geometry still costs drawing and
retained blocks still cost memory. Rendered performance beside inference has
not been established by the operation-count tests.

The existing scene-solid GPU producer builds the kiln collision snapshot once
at 64³. Its resources are released after readback; the shared renderer device
remains owned by the host. The ash solver uses that immutable mask and the
shared ground height. This fixed kiln fixture does not establish general
collision coverage for arbitrary generated meshes or changed scene geometry.

A contact transfers material into a nearby shell. If that shell has insufficient
capacity, material remains in place and the result reports `blocked`. Contact
is an impulse; after it is released, unsupported edges can settle back. The
checkpoint preserves sparse amounts, active frontier order and tick, so an
interrupted deposit resumes identically. Kiln identity, transform and cell
mapping must match on restore. No mass is silently pruned; sub-tolerance
transfers remain stored.

## Agent operations and checks

`window.kaminosWorkbenchExperiments.invoke(name, input)` exposes `deposit`,
`press`, `setContactRadius`, `play`, `frame`, `checkpoint`, `restore`, and `read`.
Operations use the same implementation as the visible controls. Deposits are
explicitly seeded; integration with actual combustion residue remains work
for this capability's next composition step.

Run `npm test -- --only tests/ash-deposit.mjs,tests/ash-surface.mjs`.
The integration witness accepts `--url`, `--repo`, `--out`, `--browser` and
`--playwright` paths: `node tools/ash-witness.mjs ...`. Use an independent
Chromium/Chrome for Testing executable. It verifies the served checkout,
captures empty/deposited/contact/restored frames, restores through a fresh page,
rejects a mismatched checkpoint and deposits again. `--negative-unmounted yes`
exercises failure after losing the mounted experiment; `--negative-pageerror yes` injects a browser failure while numerical operations remain functional. The report survives
failure and the owned browser closes. This is a visual/integration witness,
not a frame-budget benchmark.
