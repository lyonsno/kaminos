import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Emitter rewrite, slice 1 (flame-doctor, 2026-09-28): the source law
// `inflow-boundary`. The emitter stops being an interior push: its footprint
// becomes an aperture on the floor face, the converged pressure solve sees a
// prescribed inflow velocity through that face and accommodates it, and the
// backtrace below the floor reads the inflow state (velocity, fuel fraction,
// inlet temperature) from a ghost cell instead of the floor cell. No per-step
// velocity increment, no clamp, no max() floors. Opt-in; saved basins unchanged.

const core = await import('../volume-core.js');
const basis = await import('../volume-emitter-basis.mjs');
const runtime = await import('../volume-emitter-runtime.mjs');
const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

function wgslFunction(name) {
  const start = source.indexOf(`\nfn ${name}(`);
  assert.notEqual(start, -1, `production helper ${name} exists`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function mainKernel() {
  const start = source.indexOf('\nfn cs(@builtin(global_invocation_id) gid: vec3<u32>) {');
  assert.notEqual(start, -1, 'main sim kernel is located');
  const end = source.indexOf('\n@compute', start + 10);
  return source.slice(start, end === -1 ? undefined : end);
}

const ringRequest = {
  family: 'ring',
  origin: [0.1, -0.76, -0.05],
  direction: [0, 1, 0],
  supportAxis: [1, 0, 0],
  radius: 0.14,
  ringRadius: 0.7,
  strength: 2.5,
  sourceLaw: 'inflow-boundary',
  inletVelocity: 0.3,
  momentumLinked: true,
  fuelFraction: 0.6,
  inletTemperature: 1.1,
  chemistry: { smoke: 0.24, heat: 1.32, fuel: 0.78, flame: 1.16, detail: 0.72 },
};

test('the compiler knows the inflow-boundary law: floor aperture, no interior injection, link ignored, inflow state carried', () => {
  assert.deepEqual([...basis.VOLUME_EMITTER_SOURCE_LAWS], ['legacy-volume', 'shallow-primary', 'inflow-boundary']);
  assert.deepEqual([...basis.VOLUME_EMITTER_WRITABLE_FLUID_COMPONENT_INDICES['inflow-boundary']], [], 'the interior kernel writes nothing under the inflow law');
  const compiled = basis.compileVolumeEmitterFamily(ringRequest);
  const d = compiled.descriptor;
  assert.equal(d.sourceLaw, 'inflow-boundary');
  assert.deepEqual(d.injectedFields, [], 'nothing is injected in the interior');
  assert.deepEqual(d.writableFluidComponentIndices, []);
  assert.equal(d.compactSupport.interior, 'floor-aperture');
  assert.equal(d.origin[1], -1, 'the aperture sits on the floor face; the pose height is not a source height');
  assert.equal(d.inflow.apertureKind, 'annulus');
  assert.deepEqual(d.inflow.center, [0.1, -0.05]);
  assert.equal(d.inflow.ringRadius, 0.7);
  assert.equal(d.inflow.bandHalfWidth, 0.14);
  assert.equal(d.inflow.inletVelocity, 0.3, 'the inlet is a face velocity, the requested value');
  assert.equal(d.effectiveInletVelocity, 0.3, 'Link momentum to flow does not touch a prescribed inflow');
  assert.equal(d.inflow.linkIgnored, true);
  assert.equal(d.inflow.fuelFraction, 0.6);
  assert.equal(d.inflow.inletTemperature, 1.1);
  assert.equal(compiled.effective.inflow.apertureKind, 'annulus');
  // Family → aperture kind.
  assert.equal(basis.compileVolumeEmitterFamily({ ...ringRequest, family: 'nozzle', length: 0.4, ringRadius: undefined }).descriptor.inflow.apertureKind, 'disc');
  assert.equal(basis.compileVolumeEmitterFamily({ ...ringRequest, family: 'wick', length: 0.4, ringRadius: undefined }).descriptor.inflow.apertureKind, 'disc');
  const ribbon = basis.compileVolumeEmitterFamily({ ...ringRequest, family: 'ribbon', length: 0.6, ringRadius: undefined }).descriptor.inflow;
  assert.equal(ribbon.apertureKind, 'rectangle');
  assert.equal(ribbon.halfLength, 0.3);
  assert.deepEqual(ribbon.sideAxis, [1, 0]);
  // Defaults and bounds.
  const defaults = basis.compileVolumeEmitterFamily({ ...ringRequest, fuelFraction: undefined, inletTemperature: undefined }).descriptor.inflow;
  assert.equal(defaults.fuelFraction, 0.56);
  assert.equal(defaults.inletTemperature, 1.2);
  assert.throws(() => basis.compileVolumeEmitterFamily({ ...ringRequest, fuelFraction: 1.5 }), /fuelFraction/);
  assert.throws(() => basis.compileVolumeEmitterFamily({ ...ringRequest, direction: [0.3, 1, 0] }), /vertical/, 'a tilted emitter has no floor aperture');
  assert.throws(() => basis.compileVolumeEmitterFamily({ ...ringRequest, origin: [0.5, -0.76, 0], ringRadius: 0.7 }), /floor/, 'the aperture must lie within the floor face');
  // The other laws are untouched.
  const shallow = basis.compileVolumeEmitterFamily({ ...ringRequest, sourceLaw: 'shallow-primary' }).descriptor;
  assert.equal(shallow.inflow, undefined);
  assert.equal(shallow.origin[1], -0.76);
});

test('the runtime passes fuel fraction and inlet temperature through and reports the inflow block', () => {
  const calls = [];
  const prototype = {
    setControls: () => {},
    setCoreEmitterSourceMode: mode => ({ requestedMode: mode, effectiveMode: mode, effectiveFlowRate: 0 }),
    setAnalyticEmitterDescriptor: descriptor => {
      calls.push(descriptor);
      return descriptor
        ? { mode: 'analytic-fixed', ...descriptor, count: 1, coordinateSpace: 'volume-local' }
        : { mode: 'off', family: 'cluster', sourceLaw: 'legacy-volume', sourceDepth: 0.04, count: 0, coordinateSpace: 'none' };
    },
  };
  const receipt = runtime.applyVolumeEmitterFamilyRuntime({
    prototype,
    family: 'ring',
    controls: { inputRadius: 0.7, flowRate: 2.5, emitterSourceLaw: 'inflow-boundary', emitterInletVelocity: 0.3, emitterFuelFraction: 0.5, emitterInletTemperature: 0.9, speed: 1 },
  });
  assert.equal(receipt.requested.sourceLaw, 'inflow-boundary');
  assert.equal(receipt.requested.fuelFraction, 0.5);
  assert.equal(receipt.requested.inletTemperature, 0.9);
  assert.equal(receipt.effective.inflow.apertureKind, 'annulus');
  assert.equal(receipt.effective.inflow.inletVelocity, 0.3);
  assert.equal(calls[0].inflow.fuelFraction, 0.5);
});

test('the core admits the law, normalizes the inflow block, and dispatches no interior injection for it', () => {
  const compiled = basis.compileVolumeEmitterFamily(ringRequest);
  const dispatch = core.analyticEmitterInjectionDispatch(compiled.descriptor, 64, 128, 64);
  assert.equal(dispatch.active, false, 'the interior emitter kernel does not run under the inflow law');
  assert.equal(dispatch.cellCount, 0);
  assert.equal(dispatch.reason, 'inflow-boundary-has-no-interior-injection');
  const shallowDispatch = core.analyticEmitterInjectionDispatch(basis.compileVolumeEmitterFamily({ ...ringRequest, sourceLaw: 'shallow-primary' }).descriptor, 64, 128, 64);
  assert.equal(shallowDispatch.active, true, 'the shallow law still injects in the interior');
  const floats = new Float32Array(36); const words = new Uint32Array(floats.buffer);
  core.writeAnalyticEmitterInjectionUniform(floats, words, compiled.descriptor, dispatch, 0, { incrementScale: 2 });
  assert.equal(floats[26], 0, 'no per-step inlet increment is packed for a prescribed inflow');
});

test('the inflow resolver admits only a converged open-top solve and packs the aperture for the shader', async () => {
  const compiled = basis.compileVolumeEmitterFamily(ringRequest);
  const admitted = core.resolveInflowBoundaryConfig({ pressureSolver: 'converged-open-top' }, compiled.descriptor, { grid: 64 });
  assert.equal(admitted.effective.admitted, true);
  assert.equal(admitted.effective.mode, 'inflow-boundary');
  assert.equal(admitted.effective.apertureKind, 'annulus');
  assert.deepEqual(admitted.effective.center, [0.1, -0.05]);
  assert.equal(admitted.effective.ringRadius, 0.7);
  assert.equal(admitted.effective.bandHalfWidth, 0.14);
  assert.equal(admitted.effective.inletVelocity, 0.3);
  assert.equal(admitted.effective.fuelFraction, 0.6);
  assert.equal(admitted.effective.inletTemperature, 1.1);
  assert.ok(Math.abs(admitted.effective.antialiasWidth - 2 / 64) < 1e-12, 'one cell of antialias at the aperture edge');
  assert.equal(admitted.effective.reason, null);
  const closedTop = core.resolveInflowBoundaryConfig({ pressureSolver: 'converged' }, compiled.descriptor, { grid: 64 });
  assert.equal(closedTop.effective.admitted, false);
  assert.equal(closedTop.effective.mode, 'off');
  assert.equal(closedTop.effective.reason, 'inflow-boundary-requires-converged-open-top-pressure-solver');
  const legacySolver = core.resolveInflowBoundaryConfig({ pressureSolver: 'legacy' }, compiled.descriptor, { grid: 64 });
  assert.equal(legacySolver.effective.admitted, false);
  const notInflow = core.resolveInflowBoundaryConfig({ pressureSolver: 'converged-open-top' }, basis.compileVolumeEmitterFamily({ ...ringRequest, sourceLaw: 'shallow-primary' }).descriptor, { grid: 64 });
  assert.equal(notInflow.effective.admitted, false);
  assert.equal(notInflow.effective.reason, 'source-law-is-not-inflow-boundary');
  const noDescriptor = core.resolveInflowBoundaryConfig({ pressureSolver: 'converged-open-top' }, null, { grid: 64 });
  assert.equal(noDescriptor.effective.reason, 'no-analytic-emitter');
  // Packed uniform: three vec4 — aperture (mode, cx, cz, ring radius), state (band, inlet velocity, fuel, temperature), shape (side x, side z, half length, antialias).
  const packed = core.inflowBoundaryUniformValues(admitted);
  assert.equal(packed.length, 12);
  assert.deepEqual([...packed.slice(0, 4)], [core.INFLOW_APERTURE_KIND_MODE.annulus, 0.1, -0.05, 0.7]);
  assert.deepEqual([...packed.slice(4, 8)], [0.14, 0.3, 0.6, 1.1]);
  assert.deepEqual([...packed.slice(8, 11)], [1, 0, 0]);
  assert.ok(Math.abs(packed[11] - 2 / 64) < 1e-12);
  assert.deepEqual([...core.inflowBoundaryUniformValues(closedTop)], new Array(12).fill(0), 'a refused inflow packs mode 0');
  // Fresh review of 51b856f5, finding 1: the solver name is not the solve. When
  // the pressure dispatch is disabled (iterations 0, projection 0) no solve
  // accommodates the flux, so the inflow must not be admitted; a partial
  // projection gain is admitted but named.
  const noSweeps = core.resolveInflowBoundaryConfig({ pressureSolver: 'converged-open-top', pressureIterations: 0 }, compiled.descriptor, { grid: 64 });
  assert.equal(noSweeps.effective.admitted, false);
  assert.equal(noSweeps.effective.reason, 'inflow-boundary-requires-pressure-projection-dispatch:pressure-iterations-zero');
  const noProjection = core.resolveInflowBoundaryConfig({ pressureSolver: 'converged-open-top', projection: 0 }, compiled.descriptor, { grid: 64 });
  assert.equal(noProjection.effective.admitted, false);
  assert.equal(noProjection.effective.reason, 'inflow-boundary-requires-pressure-projection-dispatch:projection-zero');
  assert.equal(admitted.effective.projection, 'partial', 'the default projection gain 0.65 is a partial projection and the receipt says so');
  assert.equal(core.resolveInflowBoundaryConfig({ pressureSolver: 'converged-open-top', projection: 1 }, compiled.descriptor, { grid: 64 }).effective.projection, 'full');
  assert.equal(closedTop.effective.projection, null);
  const physicalColor = await import('../volume-physical-color.mjs');
  assert.equal(core.INFLOW_UNIFORM_OFFSET, physicalColor.PHYSICAL_COLOR_UNIFORM_FLOATS, 'the inflow slots follow the physical colour block (thermal LUT and emissive floats), the last occupied slots');
  assert.equal(core.VOLUME_UNIFORM_FLOATS, core.INFLOW_UNIFORM_OFFSET + 12);
  assert.equal(core.VOLUME_UNIFORM_FLOATS % 4, 0, 'vec4 aligned');
});

test('the shader carries the inflow as a face flux at the floor, a ghost state below it, and no sponge on the aperture', () => {
  const face = wgslFunction('compactFaceVelocity');
  assert.match(face, /if \(c\[axis\] < 0\) \{\s*if \(axis == 1u\) \{\s*return inflowFaceVelocity\(c\);\s*\}\s*return 0\.0;/, 'the ghost face below the floor carries the prescribed inflow, other lower faces none');
  const coverage = wgslFunction('inflowApertureCoverageAt');
  assert.match(coverage, /abs\(length\(q\) - u\.inflow_aperture\.w\) - band/, 'annulus');
  assert.match(coverage, /length\(q\) - band/, 'disc');
  assert.match(coverage, /max\(along, across\)/, 'rectangle');
  assert.match(coverage, /1\.0 - smoothstep\(-0\.5 \* aa, 0\.5 \* aa, signedDistance\)/, 'one-cell antialias from the packed width');
  const weight = wgslFunction('inflowApertureWeight');
  assert.match(weight, /u\.inflow_aperture\.x < 0\.5/, 'reads the aperture mode');
  assert.match(weight, /for \(var sx = 0; sx < 4; sx = sx \+ 1\)[\s\S]*for \(var sz = 0; sz < 4; sz = sz \+ 1\)[\s\S]*inflowApertureCoverageAt\(sample\)[\s\S]*coverage \* \(1\.0 \/ 16\.0\)/, 'the cell weight is the coverage averaged over a 4 x 4 stratified footprint, not the value at the cell centre (first look: the ring staircase showed as vertical striations)');
  assert.match(wgslFunction('inflowFaceVelocity'), /u\.inflow_state\.y \* inflowApertureWeight\(cell\)/);
  const ghost = wgslFunction('inflowGhostState');
  assert.match(ghost, /vec4<f32>\(0\.0, u\.inflow_state\.y, 0\.0, sample\.w\)/, 'ghost velocity is the inflow, straight up; density carried');
  // Confirmation 2 of 27ed6465: material must not depend on the cell's own
  // backtrace (from rest the first transport step admitted nothing). The ghost
  // carries momentum only; scalars enter as the face flux, below.
  assert.match(ghost, /if \(slot == 0u\) \{\s*return vec4<f32>\(0\.0, u\.inflow_state\.y, 0\.0, sample\.w\);\s*\}\s*return sample;/, 'the ghost carries momentum only; every other slot samples the domain');
  assert.doesNotMatch(ghost, /u\.inflow_state\.w, u\.inflow_state\.z/, 'no ghost material');
  const main0 = mainKernel();
  assert.match(main0, /if \(cellI\.y == 0 && u\.inflow_aperture\.x > 0\.5\) \{[\s\S]{0,600}let inflowFraction = clamp\(u\.inflow_state\.y \* inflowApertureWeight\(cellI\) \* dynamicsBacktraceScale\(\), 0\.0, 1\.0\);[\s\S]{0,300}heat = mix\(heat, u\.inflow_state\.w, inflowFraction\);\s*\n\s*fuel = mix\(fuel, u\.inflow_state\.z, inflowFraction\);/, 'the floor cells receive the inflow as the face flux: a fraction v_in x coverage x backtraceScale x dt of the cell volume becomes pure inflow each step, independent of the cell velocity');
  assert.match(main0, /smoke = mix\(smoke, 0\.0, inflowFraction\);/, 'the inflow carries no smoke');
  assert.match(main0, /flame = mix\(flame, 0\.0, inflowFraction\);[\s\S]{0,900}emberFleck = mix\(emberFleck, 0\.0, inflowFraction\);[\s\S]{0,300}combustionFrontTopology = mix\(combustionFrontTopology, 0\.0, inflowFraction\);/, 'nor any fire or detail channel');
  const blend = wgslFunction('inflowGhostBlend');
  assert.match(blend, /let below = 0\.5 - cellCenter\.y;/, 'the blend starts at the first cell centre');
  // Fresh review of 51b856f5, finding 2: the reservoir below the floor can only
  // supply what the prescribed flux carries across the face in one step, so the
  // ghost penetration is capped by v_in x backtrace scale x dt; zero flux admits
  // no ghost, a backtrace deeper than the flux allows takes only the flux's worth.
  // Confirmation 1 of 22e2c61e: the cap must be the COVERED face flux, and the
  // blend must not multiply by coverage again — at a half-covered cell whose
  // velocity equals its face velocity the old rule applied coverage twice and
  // fed half of what the prescribed flux carries.
  assert.match(blend, /let coverage = inflowApertureWeight\(column\);/, 'coverage is read once');
  assert.match(blend, /let penetration = min\(below, u\.inflow_state\.y \* coverage \* dynamicsBacktraceScale\(\)\);/, 'penetration is capped by the covered flux displacement per step');
  assert.match(blend, /return clamp\(penetration, 0\.0, 1\.0\);/, 'the ghost state is the pure inflow; the covered flux alone sets how much of it enters');
  assert.doesNotMatch(blend, /clamp\(penetration, 0\.0, 1\.0\) \* inflowApertureWeight/, 'coverage is not applied twice');
  const model = core.inflowGhostBlendModel;
  assert.equal(model({ cellCenterY: 0.0, inletVelocity: 0, backtraceScale: 3.1, timeStep: 1, apertureWeight: 1 }), 0, 'zero flux admits no ghost even for a backtrace at the face');
  assert.equal(model({ cellCenterY: -0.6, inletVelocity: 0, backtraceScale: 3.1, timeStep: 1, apertureWeight: 1 }), 0, 'nor below it');
  assert.ok(Math.abs(model({ cellCenterY: 0.035, inletVelocity: 0.15, backtraceScale: 3.1, timeStep: 1, apertureWeight: 1 }) - 0.465) < 1e-9, 'a backtrace of exactly the flux displacement takes the plain trilinear ghost weight');
  assert.ok(Math.abs(model({ cellCenterY: -0.6, inletVelocity: 0.15, backtraceScale: 3.1, timeStep: 1, apertureWeight: 1 }) - 0.465) < 1e-9, 'a deeper backtrace (existing upward flow) still takes only the flux displacement');
  assert.ok(Math.abs(model({ cellCenterY: -0.6, inletVelocity: 0.15, backtraceScale: 3.1, timeStep: 0.5, apertureWeight: 1 }) - 0.2325) < 1e-9, 'half a step carries half the flux');
  assert.equal(model({ cellCenterY: -0.6, inletVelocity: 0.5, backtraceScale: 3.1, timeStep: 1, apertureWeight: 1 }), 1, 'a flux that reaches past the ghost centre saturates at the ghost state');
  assert.equal(model({ cellCenterY: 0.7, inletVelocity: 0.5, backtraceScale: 3.1, timeStep: 1, apertureWeight: 1 }), 0, 'above the first cell centre there is no ghost');
  assert.equal(model({ cellCenterY: -0.6, inletVelocity: 0.5, backtraceScale: 3.1, timeStep: 1, apertureWeight: 0 }), 0, 'outside the aperture there is no ghost');
  assert.ok(Math.abs(model({ cellCenterY: 0.5 - 0.2325, inletVelocity: 0.15, backtraceScale: 3.1, timeStep: 1, apertureWeight: 0.5 }) - 0.2325) < 1e-9, 'a half-covered cell whose backtrace equals its covered face flux takes exactly that flux of the pure inflow state (not coverage squared)');
  assert.ok(Math.abs(model({ cellCenterY: -0.6, inletVelocity: 0.15, backtraceScale: 3.1, timeStep: 1, apertureWeight: 0.5 }) - 0.2325) < 1e-9, 'and no more when driven deeper');
  // The complete floor-cell scalar update, modelled on the kernel's transport
  // for one column (semi-Lagrangian sample with the ghost; MacCormack predictor,
  // reverse trace and neighbour-extrema limiter): fuel entering an initially
  // empty floor cell in one step against the prescribed covered face flux
  // c_in x v_in x coverage x backtraceScale x dt.
  const entry = core.inflowFloorCellEntryModel;
  for (const scheme of ['first-order', 'maccormack']) {
    for (const coverage of [1, 0.5, 0.25]) {
      const expected = 0.56 * 0.15 * coverage * 3.1;
      const got = entry({ scheme, inletVelocity: 0.15, coverage, backtraceScale: 3.1, timeStep: 1, fuelFraction: 0.56, inletTemperature: 1.2 });
      assert.ok(Math.abs(got.fuel - expected) < 1e-9, `${scheme} coverage ${coverage}: fuel entering ${got.fuel} equals the covered flux ${expected}`);
      assert.ok(Math.abs(got.heat - 1.2 * 0.15 * coverage * 3.1) < 1e-9, `${scheme} coverage ${coverage}: heat entering follows the same flux`);
    }
    const halfStep = entry({ scheme, inletVelocity: 0.15, coverage: 1, backtraceScale: 3.1, timeStep: 0.5, fuelFraction: 0.56, inletTemperature: 1.2 });
    assert.ok(Math.abs(halfStep.fuel - 0.56 * 0.15 * 3.1 * 0.5) < 1e-9, `${scheme}: half a step admits half the flux`);
    const zeroFlux = entry({ scheme, inletVelocity: 0, coverage: 1, backtraceScale: 3.1, timeStep: 1, fuelFraction: 0.56, inletTemperature: 1.2, cellVelocity: 0.2 });
    assert.equal(zeroFlux.fuel, 0, `${scheme}: an existing upward velocity with zero inlet admits nothing`);
    assert.equal(zeroFlux.heat, 0);
    const runningAhead = entry({ scheme, inletVelocity: 0.15, coverage: 1, backtraceScale: 3.1, timeStep: 1, fuelFraction: 0.56, inletTemperature: 1.2, cellVelocity: 0.4 });
    assert.ok(Math.abs(runningAhead.fuel - 0.56 * 0.15 * 3.1) < 1e-9, `${scheme}: an interior running ahead of the flux still admits only the flux`);
    // Confirmation 2 of 27ed6465: a resting or slower interior must not starve
    // the entry; the prescribed lower-face supply is independent of the
    // upper-face backtrace.
    const atRest = entry({ scheme, inletVelocity: 0.15, coverage: 1, backtraceScale: 3.1, timeStep: 1, fuelFraction: 0.56, inletTemperature: 1.2, cellVelocity: 0 });
    assert.ok(Math.abs(atRest.fuel - 0.56 * 0.15 * 3.1) < 1e-9, `${scheme}: from rest the first step admits the full flux`);
    const slower = entry({ scheme, inletVelocity: 0.15, coverage: 0.5, backtraceScale: 3.1, timeStep: 1, fuelFraction: 0.56, inletTemperature: 1.2, cellVelocity: 0.05 });
    assert.ok(Math.abs(slower.fuel - 0.56 * 0.15 * 0.5 * 3.1) < 1e-9, `${scheme}: a slower interior admits the covered flux`);
    assert.ok(Math.abs(slower.heat - 1.2 * 0.15 * 0.5 * 3.1) < 1e-9);
  }
  for (const sampler of ['sampleFluidSlot', 'samplePredictSlot']) {
    const body = wgslFunction(sampler);
    assert.match(body, /let ghost = inflowGhostBlend\(cellCenter\);/, `${sampler} blends toward the ghost`);
    assert.match(body, /return mix\([a-zA-Z0-9_(), .]+, inflowGhostState\(slot, [a-zA-Z0-9_]+\), ghost\);/, `${sampler} returns the blended sample`);
  }
  const macCormack = wgslFunction('macCormackSlot');
  assert.match(macCormack, /let predicted = fluidPredict\[idx \* SLOTS_PER_CELL \+ slot\];[\s\S]{0,600}if \(inflowGhostBlend\(backCell\) > 0\.0\) \{\s*return predicted;\s*\}\s*let reversed = samplePredictSlot\(forwardCell, slot\);/, 'a floor cell fed by the ghost keeps the first-order prediction: the reverse trace cannot measure an error against a reservoir outside the domain (confirmation 1 of 22e2c61e: the corrector removed ~27 % of the entering fuel)');
  const extrema = wgslFunction('slotExtrema');
  assert.match(extrema, /inflowGhostState\(slot, lo\)/, 'the MacCormack limiter range admits the ghost state so the inflow is not reverted at the floor');
  const main = mainKernel();
  assert.match(main, /let floorExempt = select\(0\.0, inflowApertureWeight\(cellI\), p\.y < -0\.8\);\s*\n\s*let verticalWall = max\(mix\(-p\.y, -1\.0, floorExempt\), p\.y - expandedTopY \+ 1\.0\);/, 'the wall sponge does not act on the floor inside the aperture (evaluated only in the floor band)');
  assert.match(source, /inflow_aperture: vec4<f32>,\s*\n[\s\S]{0,400}inflow_state: vec4<f32>,\s*\n[\s\S]{0,400}inflow_shape: vec4<f32>,/, 'three inflow vec4s in the uniform struct');
  const project = wgslFunction('csProjectPressureConverged');
  assert.doesNotMatch(project, /inflow/, 'the projection needs no inflow branch: the floor face is never stored, so the prescribed flux survives by construction');
});

test('cockpit: the law is selectable, the two inflow controls exist and recompile the emitter, the receipt names admission', () => {
  assert.match(index, /<option value="inflow-boundary">Inflow boundary \(floor\)<\/option>/);
  assert.match(index, /id="volume-emitter-fuel-fraction" data-volume-settings-param="volume_emitter_fuel_fraction" min="0" max="1" step="any" value="0.56"/);
  assert.match(index, /id="volume-emitter-inlet-temperature" data-volume-settings-param="volume_emitter_inlet_temperature" min="0" max="2.4" step="any" value="1.2"/);
  assert.match(index, /emitterFuelFraction: parseFloat\(document\.getElementById\('volume-emitter-fuel-fraction'\)\.value\)/);
  assert.match(index, /emitterInletTemperature: parseFloat\(document\.getElementById\('volume-emitter-inlet-temperature'\)\.value\)/);
  assert.match(index, /'volume-emitter-fuel-fraction',\s*\n\s*'volume-emitter-inlet-temperature',/, 'both recompile the emitter');
  assert.match(index, /Inflow boundary puts the emitter's footprint on the floor face as a prescribed inflow/, 'the help says what the law is');
  assert.match(index, /the floor cells take in the inflow's fuel and temperature in proportion to that flux each step/, 'and how material enters');
  assert.match(index, /needs the converged open-top pressure solver/, 'and what it needs');
  const keys = schema.controls.map(control => control.key);
  assert.ok(keys.includes('volume-emitter-fuel-fraction'));
  assert.ok(keys.includes('volume-emitter-inlet-temperature'));
  assert.equal(schema.controls.find(control => control.key === 'volume-emitter-fuel-fraction').additiveDefault, 0.56);
  assert.equal(schema.controls.find(control => control.key === 'volume-emitter-inlet-temperature').additiveDefault, 1.2);
  assert.equal(schema.controlCount, 218);
  assert.match(source, /state\.inflowBoundary = inflowBoundaryConfig;/, 'the receipt carries the resolved inflow');
  assert.match(index, /id="volume-inflow-boundary-state"/, 'the cockpit shows the inflow admission');
  assert.match(index, /NOT admitted: \$\{inflow\.effective\.reason\}/, 'a requested but refused inflow looks refused');
  assert.match(index, /admitted · \$\{inflow\.effective\.apertureKind\}/, 'an admitted inflow names its aperture and state');
  assert.match(index, /projection \$\{inflow\.effective\.projection\}/, 'and its projection regime (full or partial)');
  // 2026-09-29, Noah: switching to the law on an approved basin gave a black
  // screen — the basins load the legacy solver, the law was refused, and the
  // rebuilt empty state had no source. The refusal must sit next to the select.
  assert.match(index, /sourceLawValue\.textContent = inflow\.effective\.admitted\s*\n\s*\? 'inflow-boundary · admitted'\s*\n\s*: `inflow-boundary — NOT ADMITTED \(\$\{inflow\.effective\.reason\}\); set Pressure solver to converged open top and Projection above 0`/, 'a refused inflow is named next to the Source Law select, with the fix');
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /inflowBoundary: s\.inflowBoundary \?\? null/, 'the arm capture records the inflow receipt');
  assert.match(capture, /inflow-boundary/, 'and checks that an arm asking for the law was admitted');
});
