import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Time step (flame-doctor slice 4). Speed has never been a time step: it scales
// buoyancy and the advection backtrace but not the inlet velocity, entrainment,
// expansion or confinement, so lowering it changes the regime (injected
// momentum wins, the plume sloshes) instead of the rate. The opt-in `uniform`
// mode reads every authored coefficient at a reference Speed and scales the
// transport distance, every per-step velocity increment and the emitter inlet
// velocity by the same factor, so Speed becomes a rate multiplier.

const core = await import('../volume-core.js');
const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../volume-cockpit-layout.mjs', import.meta.url), 'utf8');
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
const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('resolveTimeStepConfig keeps the legacy law by default', () => {
  assert.equal(typeof core.resolveTimeStepConfig, 'function');
  assert.deepEqual([...core.TIME_STEP_MODE_VALUES], ['legacy', 'uniform']);
  assert.equal(core.TIME_STEP_REFERENCE_SPEED, 1);
  const legacy = core.resolveTimeStepConfig({ speed: 3.4, advectionScheme: 'maccormack' });
  assert.equal(legacy.effective.mode, 'legacy');
  assert.equal(legacy.effective.dtScale, 1);
  assert.equal(legacy.effective.dynamicsSpeed, 3.4);
  near(legacy.effective.backtraceScale, 2.55 + 0.55 * 3.4);
  assert.equal(legacy.effective.inletVelocityScale, 1);
  assert.equal(legacy.effective.reason, null);
  const unknown = core.resolveTimeStepConfig({ timeStep: 'bogus', speed: 1 });
  assert.equal(unknown.effective.mode, 'legacy');
  assert.match(unknown.effective.reason, /unknown/);
});

test('uniform mode makes Speed a rate multiplier on one shared characteristic', () => {
  const uniform = core.resolveTimeStepConfig({ timeStep: 'uniform', speed: 3.4, advectionScheme: 'maccormack-velocity' });
  assert.equal(uniform.effective.mode, 'uniform');
  near(uniform.effective.dtScale, 3.4);
  assert.equal(uniform.effective.dynamicsSpeed, 1, 'authored coefficients are read at the reference Speed');
  near(uniform.effective.backtraceScale, (2.55 + 0.55) * 3.4, 1e-9);
  near(uniform.effective.inletVelocityScale, 3.4);
  assert.equal(uniform.effective.reason, null);
  const atReference = core.resolveTimeStepConfig({ timeStep: 'uniform', speed: 1, advectionScheme: 'maccormack' });
  near(atReference.effective.backtraceScale, core.resolveTimeStepConfig({ speed: 1, advectionScheme: 'maccormack' }).effective.backtraceScale, 1e-12);
  assert.equal(atReference.effective.dtScale, 1, 'at the reference Speed uniform and legacy coincide');
  const half = core.resolveTimeStepConfig({ timeStep: 'uniform', speed: 0.5, advectionScheme: 'maccormack' });
  near(half.effective.backtraceScale, uniform.effective.backtraceScale * (0.5 / 3.4), 1e-9);
  // Legacy per-layer transport carries its own speed-dependent lifts, so the
  // uniform step is only defined on the common-gas characteristic.
  const split = core.resolveTimeStepConfig({ timeStep: 'uniform', speed: 2, advectionScheme: 'legacy', commonGasTransport: false });
  assert.equal(split.effective.mode, 'legacy');
  assert.match(split.effective.reason, /common-gas characteristic/);
  const commonLegacy = core.resolveTimeStepConfig({ timeStep: 'uniform', speed: 2, advectionScheme: 'legacy', commonGasTransport: true });
  assert.equal(commonLegacy.effective.mode, 'uniform');
});

test('the shader reads coefficients at the dynamics speed and scales transport, increments and bounds by one factor', () => {
  const main = mainKernel();
  assert.match(source, /uniforms\[354\] = timeStepModeUniformValue\(timeStepConfig\.effective\.mode\);/, 'mode packed at slot 354');
  assert.match(source, /uniforms\[355\] = timeStepConfig\.effective\.referenceSpeed;/, 'reference speed packed at slot 355');
  const scale = wgslFunction('timeStepScale');
  assert.match(scale, /u\.reserved_source_extension_2\.z > 0\.5/, 'uniform mode read from slot 354');
  assert.match(scale, /u\.fire_smoke_curl_speed\.w \/ /, 'dt scale is requested Speed over the reference');
  const dyn = wgslFunction('dynamicsSpeed');
  assert.match(dyn, /select\(u\.fire_smoke_curl_speed\.w, /, 'dynamics speed is the reference under uniform mode');
  const bt = wgslFunction('dynamicsBacktraceScale');
  assert.match(bt, /transportBacktraceScale\(dynamicsSpeed\(\)\) \* timeStepScale\(\)/, 'backtrace scale carries the dt factor');
  assert.match(main, /let requestedSpeed = u\.fire_smoke_curl_speed\.w;\s*\n\s*let speed = dynamicsSpeed\(\);\s*\n\s*let timeStep = timeStepScale\(\);/, 'main kernel derives speed and dt from the helpers');
  assert.match(main, /let backtraceScale = transportBacktraceScale\(speed\) \* timeStep;/, 'main kernel backtrace scales with dt');
  assert.match(main, /let velTransported = advected\.xyz \* transportVelocityDamping\(\);\s*\n\s*var vel = velTransported;/, 'the transported velocity is kept apart from the increments');
  assert.match(main, /vel = velTransported \+ \(vel - velTransported\) \* timeStep;/, 'every per-step increment scales with dt in one place');
  assert.ok(main.indexOf('vel = velTransported + (vel - velTransported) * timeStep;') > main.indexOf('vel = vel - projectionCorrection'), 'the scaling follows the last additive increment');
  assert.ok(main.indexOf('vel = velTransported + (vel - velTransported) * timeStep;') < main.indexOf('vel = vel * mix(0.55, 1.0, wallFade);'), 'the scaling precedes the wall damping');
  const bound = wgslFunction('boundVelocity');
  assert.match(bound, /fn boundVelocity\(v: vec3<f32>\) -> vec3<f32>/, 'the bound reads the effective backtrace itself');
  assert.match(bound, /\/ dynamicsBacktraceScale\(\)/, 'the bound divides by the dt-scaled backtrace');
  assert.doesNotMatch(source, /boundVelocity\([^)]*, /, 'no caller passes a speed to the bound any more');
  const predictor = source.slice(source.indexOf('fn csTransportPredict('), source.indexOf('\nfn cs(@builtin'));
  assert.match(predictor, /dynamicsBacktraceScale\(\)/, 'the MacCormack predictor uses the same effective backtrace');
  assert.doesNotMatch(predictor, /transportBacktraceScale\(speed\)/, 'the predictor no longer reads the raw speed backtrace');
});

test('the emitter inlet velocity carries the dt factor and the receipt names it', () => {
  const floats = new Float32Array(40); const words = new Uint32Array(floats.buffer);
  assert.match(source, /new ArrayBuffer\(40 \* Float32Array\.BYTES_PER_ELEMENT\)/, 'the emitter uniform grew by one vec4 for the time-step bound');
  const descriptor = {
    family: 'ring', inletProfile: 'edge-entrained', momentumLinked: false, effectiveInletVelocity: 0.74, shearWidthCells: 0.5, edgeEntrainment: 1.62,
    origin: [0, -0.9, 0], axis: [0, 1, 0], supportAxis: [1, 0, 0], radius: 0.3, extent: [0, 0, 0], strength: 1, velocitySpeed: 0, transportSpeed: 0,
    sourceLaw: 'shallow-primary', sourceDepth: 0.01, chemistry: { smoke: 0, heat: 1, fuel: 1, flame: 0, detail: 0 }, geometry: [0, 0, 0],
  };
  const dispatch = { cellMin: [0, 0, 0], cellExtent: [1, 1, 1], grid: 64, workgroups: [1, 1, 1], active: true, cellCount: 1, family: 'ring' };
  core.writeAnalyticEmitterInjectionUniform(floats, words, descriptor, dispatch, 0);
  near(floats[26], Math.fround(0.74), 0, 'default packing is unchanged');
  core.writeAnalyticEmitterInjectionUniform(floats, words, descriptor, dispatch, 0, { inletVelocityScale: 3.4 });
  near(floats[26], Math.fround(0.74 * 3.4), 1e-6, 'uniform mode scales the packed inlet velocity');
  assert.equal(floats[36], 0, 'without a bound option the emitter keeps the legacy clamp');
  core.writeAnalyticEmitterInjectionUniform(floats, words, descriptor, dispatch, 0, { inletVelocityScale: 3.4, emitterVelocityBound: 0.76 });
  near(floats[36], Math.fround(0.76), 1e-7, 'the uniform-mode magnitude bound is packed at float 36');
  const injection = source.slice(source.indexOf('struct AnalyticEmitterInjectionUniforms'), source.indexOf('material.x = max(material.x, chemistry.x * chemistryWeight * 0.76);'));
  assert.match(injection, /time_step_controls: vec4<f32>,/, 'the emitter uniform declares the time-step controls');
  assert.match(injection, /var injectedVelocity = clamp\(injectedRaw, vec3<f32>\(-0\.34\), vec3<f32>\(0\.52\)\);/, 'the legacy per-component clamp is unchanged');
  assert.match(injection, /if \(uniformVelocityBound > 0\.0\)[^]*?magnitude > uniformVelocityBound/, 'under the uniform step the injected velocity is bounded by magnitude instead');
  assert.match(source, /emitterVelocityBound: timeStepConfig\.effective\.mode === 'uniform' \? TRANSPORT_MAX_BACKTRACE_CELLS \/ timeStepConfig\.effective\.backtraceScale : 0,/, 'the bound is the transport bound at the effective backtrace');
  assert.match(source, /writeAnalyticEmitterInjectionUniform\([^;]*\{\s*inletVelocityScale: timeStepConfig\.effective\.inletVelocityScale,/, 'the frame packer passes the dt factor');
  assert.match(source, /state\.timeStep = \{\s*\.\.\.timeStepConfig,\s*uniform: \{ mode: uniforms\[354\], referenceSpeed: uniforms\[355\] \},\s*packedInletVelocity: [^]*?emitterVelocityBound: analyticEmitterInjectionUniformFloats\[36\],/, 'runtime receipt records the packed values and the emitter bound');
  assert.equal((source.match(/^\s*timeStep: state\.timeStep,$/gm) || []).length, 2, 'debugState exports the receipt on both routes');
});

test('cockpit, schema and layout carry the time-step mode', () => {
  assert.match(index, /<select id="volume-time-step"[^>]*data-volume-settings-param="volume_time_step"[^>]*>[^]*?<option value="legacy" selected>[^]*?<option value="uniform">/, 'Time step select, default legacy');
  assert.match(index, /\['timeStep', 'volume_time_step'\]/, 'route field');
  assert.match(index, /timeStep: document\.getElementById\('volume-time-step'\)\.value,/, 'controls read the mode');
  assert.match(index, /document\.getElementById\('volume-time-step-val'\)\.textContent = /, 'label renders the effective mode');
  assert.match(index, /\['volume-time-step', 'volume_time_step'\],/, 'route param applies the mode');
  assert.match(index, /'volume-confinement',\s*\n\s*'volume-time-step',/, 'live listener registered next to confinement');
  assert.match(layout, /\|time-step\|/, 'Simulation dynamics layout group owns the control');
  const control = schema.controls.find(entry => entry.key === 'volume-time-step');
  assert.ok(control, 'schema declares volume-time-step');
  assert.equal(control.param, 'volume_time_step');
  assert.equal(control.additiveDefault, 'legacy');
  assert.deepEqual(control.allowedValues, ['legacy', 'uniform']);
  assert.equal(control.additiveSinceControlCount, 216);
  assert.equal(schema.controlCount, 216);
  assert.equal(schema.controls.length, 216);
});

test('the arm capture records and checks the time-step mode', () => {
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /timeStep: s\.timeStep\?\.effective \?\? null/, 'effective time step in the arm receipt');
  assert.match(capture, /cid === 'volume-time-step'/, 'requested-vs-effective check covers the time-step mode');
});
