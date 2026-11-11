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
  assert.deepEqual([...basis.VOLUME_EMITTER_SOURCE_LAWS], ['legacy-volume', 'shallow-primary', 'inflow-boundary', 'immersed-source']);
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
  // Packed uniform: three vec4 — aperture (mode, cx, cz, ring radius), state (puff factor, inlet velocity, fuel, temperature), shape (swirl, turbulence intensity, unused, antialias).
  const packed = core.inflowBoundaryUniformValues(admitted);
  assert.equal(packed.length, 12);
  assert.deepEqual([...packed.slice(0, 4)], [core.INFLOW_APERTURE_KIND_MODE.annulus, 0.1, -0.05, 0.7]);
  assert.deepEqual([...packed.slice(4, 8)], [1, 0.3, 0.6, 1.1], 'a steady inlet packs puff factor 1; the band half-width left the shader with the coverage map');
  assert.deepEqual([...packed.slice(8, 11)], [0, 0, 0], 'the third vec4 carries swirl and turbulence intensity (0 here); the shape lives in the coverage map');
  assert.deepEqual(admitted.effective.inletDynamics, { turbulence: 0, turbulenceScaleCells: 6, turbulenceRms: 0, puff: 0, puffPeriod: 3, puffSignal: 0, puffFactor: 1, active: false }, 'inlet dynamics default to a steady inlet');
  const puffing = core.resolveInflowBoundaryConfig({ pressureSolver: 'converged-open-top', emitterPuff: 0.5, emitterInletTurbulence: 0.3 }, compiled.descriptor, { grid: 64, inletSignals: { puff: [-0.5], turbulence: { rms: 0.4 } } });
  assert.ok(Math.abs(puffing.effective.inletDynamics.puffFactor - 0.75) < 1e-12, 'puff factor = 1 + depth × signal');
  assert.equal(puffing.effective.inletDynamics.turbulenceRms, 0.4);
  const puffPacked = core.inflowBoundaryUniformValues(puffing);
  assert.ok(Math.abs(puffPacked[4] - 0.75) < 1e-12 && Math.abs(puffPacked[9] - 0.3) < 1e-12, 'puff factor in inflow_state.x, intensity in inflow_shape.y');
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
  assert.equal(core.OPEN_WORLD_UNIFORM_OFFSET, core.WAVELET_TURBULENCE_UNIFORM_OFFSET + core.WAVELET_TURBULENCE_UNIFORM_FLOATS, 'open-boundary parameters follow the complete wavelet block');
  assert.equal(core.DISPLAY_RECONSTRUCTION_UNIFORM_OFFSET, core.OPEN_WORLD_UNIFORM_OFFSET + 4);
  assert.equal(core.SHARED_ASH_UNIFORM_OFFSET, core.DISPLAY_RECONSTRUCTION_UNIFORM_OFFSET + 8);
  assert.equal(core.WORLD_CALIBRATION_UNIFORM_OFFSET, core.SHARED_ASH_UNIFORM_OFFSET + 4);
  assert.equal(core.VOLUME_UNIFORM_FLOATS, core.WORLD_CALIBRATION_UNIFORM_OFFSET + 8);
  assert.equal(core.VOLUME_UNIFORM_FLOATS % 4, 0, 'vec4 aligned');
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
  assert.equal(schema.controlCount, schema.controls.length);
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
  assert.match(readFileSync(new URL('../volume-arm-capture-checks.mjs', import.meta.url), 'utf8'), /inflow-boundary requested but not admitted/, 'and checks that an arm asking for the law was admitted');
});
