import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as core from '../volume-core.js';

// Low-dissipation transport: an opt-in advection scheme (legacy | undamped |
// maccormack) plus the common-gas-transport switch. These contracts bind the
// control resolver, the WGSL predictor/corrector and velocity bound, the
// cockpit plumbing, the preset schema, and the cost ledger. They are source and
// CPU evidence only; whether less dissipation lets the plume roll up on its
// own is the operator's live comparison.

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../volume-cockpit-layout.mjs', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

function wgslFunction(name) {
  const match = source.match(new RegExp(`\\nfn ${name}\\([^]*?\\n\\}`));
  return match ? match[0] : null;
}

test('transport resolver reports scheme, characteristic, damping, and bound with legacy as the default', () => {
  assert.equal(typeof core.resolveTransportConfig, 'function', 'resolveTransportConfig must be exported');
  const legacy = core.resolveTransportConfig({});
  assert.equal(legacy.effective.scheme, 'legacy');
  assert.equal(legacy.effective.commonCharacteristic, false);
  assert.equal(legacy.effective.velocityDamping, 0.982);
  assert.deepEqual(legacy.effective.velocityBound, { kind: 'fixed-component', min: -0.34, max: 0.52 });
  assert.equal(legacy.effective.predictorPass, false);

  const commonGas = core.resolveTransportConfig({ commonGasTransport: true });
  assert.equal(commonGas.effective.scheme, 'legacy');
  assert.equal(commonGas.effective.commonCharacteristic, true, 'common gas transport is honored under the legacy scheme');

  const undamped = core.resolveTransportConfig({ advectionScheme: 'undamped' });
  assert.equal(undamped.effective.scheme, 'undamped');
  assert.equal(undamped.effective.velocityDamping, 1);
  assert.equal(undamped.effective.velocityBound.kind, 'backtrace-cells');
  assert.ok(undamped.effective.velocityBound.maxCells >= 4, 'backtrace bound is several cells, not the legacy half-cell clamp');
  assert.equal(undamped.effective.predictorPass, false);
  assert.equal(undamped.effective.commonCharacteristic, false, 'undamped keeps the per-layer legacy characteristic unless common gas is selected');

  const maccormack = core.resolveTransportConfig({ advectionScheme: 'maccormack' });
  assert.equal(maccormack.effective.scheme, 'maccormack');
  assert.equal(maccormack.effective.commonCharacteristic, true, 'MacCormack always carries every slot on the velocity characteristic');
  assert.equal(maccormack.effective.velocityDamping, 1);
  assert.equal(maccormack.effective.predictorPass, true);
  assert.equal(maccormack.effective.limiter, 'neighbor-extrema-revert');
  assert.deepEqual(maccormack.effective.correctedSlots, ['velocity', 'material', 'fire', 'micro']);

  const velocityOnly = core.resolveTransportConfig({ advectionScheme: 'maccormack-velocity' });
  assert.equal(velocityOnly.effective.scheme, 'maccormack-velocity');
  assert.equal(velocityOnly.effective.predictorPass, true);
  assert.equal(velocityOnly.effective.commonCharacteristic, true, 'velocity-only MacCormack still carries scalars first-order on the shared characteristic');
  assert.deepEqual(velocityOnly.effective.correctedSlots, ['velocity']);
  assert.equal(core.transportSchemeUniformValue('maccormack-velocity'), 2);
  assert.equal(core.transportSchemeUniformValue('maccormack'), 3);

  const unknown = core.resolveTransportConfig({ advectionScheme: 'spectral' });
  assert.equal(unknown.requested.scheme, 'spectral');
  assert.equal(unknown.effective.scheme, 'legacy');
  assert.equal(unknown.effective.reason, 'unknown-scheme');
});

test('WGSL carries the predictor buffer, the MacCormack corrector with an extremum limiter, and one velocity bound helper', () => {
  assert.match(source, /@group\(3\) @binding\(1\) var<storage, read_write> fluidPredict: array<vec4<f32>>;/, 'predictor buffer lives in its own bind group 3');
  // The shared fluid layout already carries 8 compute-visible storage buffers;
  // the tiered pressure projection layout adds 2 more. Adding the predictor
  // there breached the default 10-per-stage limit on Apple WebGPU.
  const fluidLayoutStart = source.indexOf("label: 'kaminos fluid bind group layout'");
  const fluidLayout = source.slice(fluidLayoutStart, source.indexOf('});', fluidLayoutStart));
  assert.ok(fluidLayout.length > 0, 'shared fluid bind group layout must exist');
  assert.doesNotMatch(fluidLayout, /binding: 16/, 'predictor must not be added to the shared fluid bind group layout');
  assert.ok(source.includes('fn csTransportPredict('), 'predictor entry point must exist');
  const predict = wgslFunction('csTransportPredict');
  assert.match(predict, /fluidPredict\[base \+ slot\] = sampleFluidSlot\(backCell, slot\)/, 'predictor writes the forward semi-Lagrangian estimate for every slot');
  const corrector = wgslFunction('macCormackSlot');
  assert.ok(corrector, 'macCormackSlot must exist');
  assert.match(corrector, /samplePredictSlot\(forwardCell, slot\)/, 'corrector re-advects the prediction backwards along the same characteristic');
  assert.match(corrector, /\(current - reversed\) \* 0\.5/, 'MacCormack applies half the measured round-trip error');
  assert.match(corrector, /let outOfRange = \(corrected < extrema\.lo\) \| \(corrected > extrema\.hi\);\s*return select\(corrected, predicted, outOfRange\);/, 'a component outside the neighbor extrema reverts to the first-order prediction instead of clamping to the extremum');
  assert.doesNotMatch(corrector, /clamp\(corrected, extrema\.lo, extrema\.hi\)/, 'clamping to the extremum is rejected: it inflates fields toward their running maximum');
  const bound = wgslFunction('boundVelocity');
  assert.ok(bound, 'boundVelocity must exist');
  assert.match(bound, /vec3<f32>\(-0\.34\), vec3<f32>\(0\.52\)/, 'legacy scheme keeps the exact fixed component clamp');
  assert.match(bound, /transport_controls\.z/, 'non-legacy schemes bound the step by backtrace cells from the uniform');
  const velocityWrites = source.match(/fluidDst\[base\] = vec4<f32>\([^\n]*\n/g) || [];
  assert.ok(velocityWrites.length >= 4, `expected the main kernel and three projection kernels to write velocity: ${velocityWrites.length}`);
  for (const write of velocityWrites) {
    assert.match(write, /boundVelocity\(/, `every velocity write goes through boundVelocity: ${write.trim()}`);
  }
  assert.doesNotMatch(source, /var vel = advected\.xyz \* 0\.982;/, 'per-step velocity damping is no longer unconditional');
  assert.match(source, /var vel = advected\.xyz \* transportVelocityDamping\(\);/, 'velocity damping goes through the scheme-aware helper');
  const damping = wgslFunction('transportVelocityDamping');
  assert.match(damping, /0\.982/, 'legacy damping constant is preserved for the legacy scheme');
  const main = source.slice(source.indexOf('\nfn cs(@builtin(global_invocation_id)'), source.indexOf('struct RaymarchResult'));
  assert.match(main, /if \(macCormack\) \{[^]*?macCormackSlot\(cellI, idx, backCell, forwardCell, 0u\)[^]*?if \(macCormackScalars\) \{[^]*?macCormackSlot\(cellI, idx, backCell, forwardCell, 3u\)/, 'main kernel corrects velocity under both MacCormack schemes and scalars only under the all-fields scheme');
  assert.match(main, /let macCormackScalars = u\.transport_controls\.x > 2\.5;/, 'scalar correction is gated on the all-fields scheme value');
  assert.match(main, /let commonGasTransport = macCormack \|\| u\.reserved_source_extension_2\.y > 0\.5;/, 'common gas transport shares the uniform slot Sexy Fireman used, and MacCormack implies it');
  assert.match(main, /material = thermalAdvection\(cell, advectVelocity, speed, localMaterial\.y, thermalAdvectionRiseDirection\)/, 'legacy per-layer transport is retained for the legacy characteristic');
});

test('a MacCormack step with an extremum limiter retains more of a transported bump than first-order semi-Lagrangian and stays bounded', () => {
  // CPU model of the scheme as written in WGSL: forward SL prediction, reverse
  // SL of the prediction along the same velocity, half-error correction, and
  // revert to the prediction where the correction leaves the neighbor extrema
  // of the source around the backtraced point. Periodic 1-D column, uniform
  // velocity, fractional CFL.
  const N = 96;
  const u = 0.37;
  const wrap = i => ((i % N) + N) % N;
  const sample = (phi, x) => {
    const i0 = Math.floor(x);
    const f = x - i0;
    return phi[wrap(i0)] * (1 - f) + phi[wrap(i0 + 1)] * f;
  };
  const extrema = (phi, x) => {
    const i0 = Math.floor(x);
    const a = phi[wrap(i0)];
    const b = phi[wrap(i0 + 1)];
    return [Math.min(a, b), Math.max(a, b)];
  };
  const initial = Float64Array.from({ length: N }, (_, i) => Math.exp(-((i - 24) ** 2) / 8));
  const firstOrder = phi => Float64Array.from({ length: N }, (_, i) => sample(phi, i - u));
  const macCormack = phi => {
    const predicted = firstOrder(phi);
    return Float64Array.from({ length: N }, (_, i) => {
      const reversed = sample(predicted, i + u);
      const corrected = predicted[i] + (phi[i] - reversed) * 0.5;
      const [lo, hi] = extrema(phi, i - u);
      return corrected < lo || corrected > hi ? predicted[i] : corrected;
    });
  };
  let a = initial;
  let b = initial;
  for (let step = 0; step < 120; step += 1) {
    a = firstOrder(a);
    b = macCormack(b);
  }
  const peak = phi => Math.max(...phi);
  const total = phi => phi.reduce((sum, v) => sum + v, 0);
  assert.ok(peak(a) < 0.6, `first-order semi-Lagrangian has visibly diffused the bump: peak ${peak(a)}`);
  assert.ok(peak(b) > peak(a) * 1.5, `MacCormack retains substantially more peak: ${peak(b)} vs ${peak(a)}`);
  assert.ok(Math.max(...b) <= 1 + 1e-9 && Math.min(...b) >= -1e-9, 'the extremum limiter keeps the result inside the initial range (no overshoot)');
  // Reverting (rather than clamping) keeps the scheme close to conservative;
  // the clamp variant drifted +8% on this bump and inflated the 3-D fields to
  // their peak. Bound the drift tightly so a return to clamping fails here.
  assert.ok(Math.abs(total(b) - total(initial)) / total(initial) < 0.02, `revert-limited corrector mass drift stays small: ${total(b)} vs ${total(initial)}`);
});

test('cockpit plumbing carries the scheme and common-gas switch through DOM, route, controls, labels, listeners, and layout', () => {
  assert.match(index, /id="volume-advection-scheme"[^>]*data-volume-settings-param="volume_advection_scheme"/, 'scheme select is a settings control');
  assert.match(index, /<option value="legacy" selected>Legacy semi-Lagrangian/, 'legacy remains the default');
  assert.match(index, /<option value="maccormack-velocity">/, 'velocity-only MacCormack is selectable');
  assert.match(index, /<option value="maccormack">/, 'all-fields MacCormack is selectable');
  assert.match(index, /id="volume-common-gas-transport"[^>]*data-volume-settings-param="volume_common_gas_transport"/, 'common gas transport checkbox is a settings control');
  assert.match(index, /\['advectionScheme', 'volume_advection_scheme'\]/, 'route field carries the scheme');
  assert.match(index, /\['commonGasTransport', 'volume_common_gas_transport'\]/, 'route field carries common gas transport');
  assert.match(index, /advectionScheme: document\.getElementById\('volume-advection-scheme'\)\.value/, 'controls read the scheme');
  assert.match(index, /commonGasTransport: document\.getElementById\('volume-common-gas-transport'\)\.checked/, 'controls read common gas transport');
  assert.match(index, /volume-advection-scheme-val'\)\.textContent/, 'scheme label renders the effective scheme');
  assert.match(index, /'volume-advection-scheme',\s*\n\s*'volume-common-gas-transport',/, 'both controls register live listeners');
  assert.match(index, /\['volume-advection-scheme', 'volume_advection_scheme'\]/, 'route params apply the scheme');
  assert.match(index, /resolveTransportConfig/, 'cockpit label uses the shared resolver');
  assert.match(layout, /advection-scheme\|common-gas-transport/, 'both controls belong to the Simulation dynamics layout group');
});

test('preset schema declares both controls additively so historical basins project to legacy transport', () => {
  const scheme = schema.controls.find(control => control.key === 'volume-advection-scheme');
  const commonGas = schema.controls.find(control => control.key === 'volume-common-gas-transport');
  assert.ok(scheme, 'schema must declare volume-advection-scheme');
  assert.ok(commonGas, 'schema must declare volume-common-gas-transport');
  assert.equal(scheme.additiveDefault, 'legacy');
  assert.deepEqual(scheme.allowedValues, ['legacy', 'undamped', 'maccormack-velocity', 'maccormack']);
  assert.equal(commonGas.type, 'checkbox');
  assert.equal(commonGas.additiveDefault, false);
  assert.equal(schema.controlCount, schema.controls.length);
});

test('runtime receipt, predictor dispatch, and cost ledger name the transport scheme', () => {
  assert.match(source, /transport: state\.transport/, 'debug state exports the transport receipt');
  assert.match(source, /transportPredictorPasses/, 'cost ledger counts the predictor pass');
  const encodeSim = source.slice(source.indexOf('  function encodeSim(encoder'), source.indexOf('  function retirePressureResidualMap('));
  assert.match(encodeSim, /predictorPass[^]*?transportPredictPipeline[^]*?pass\.setPipeline\(computePipeline\)/, 'predictor pass is encoded before the main sim pass when the scheme requests it');
  assert.match(source, /uniforms\[353\] = transportConfig\.effective\.commonCharacteristic \? 1 : 0;/, 'common characteristic is packed at slot 353');
  assert.match(source, /uniforms\[360\] = transportSchemeUniformValue\(transportConfig\.effective\.scheme\);/, 'scheme is packed at slot 360');
  assert.match(source, /transportPredictBindGroupLayout = device\.createBindGroupLayout\(\{[^]*?entries: \[\s*\{ binding: 1, visibility: GPUShaderStage\.COMPUTE, buffer: \{ type: 'storage' \} \},?\s*\]/, 'predictor bind group layout declares exactly one storage buffer');
  assert.match(source, /transportPipelineLayout = device\.createPipelineLayout\(\{[^]*?bindGroupLayouts: \[bindGroupLayout, emptyBindGroupLayout, emptyBindGroupLayout, transportPredictBindGroupLayout\]/, 'transport pipelines use a private layout with the predictor at index 3');
  assert.match(source, /\{ binding: 1, resource: \{ buffer: fluidPredictBuffer \} \}/, 'predictor bind group binds the predictor buffer');
  assert.match(encodeSim, /predictor\.setBindGroup\(3, transportPredictBindGroup\)/, 'predictor pass sets bind group 3');
  assert.match(encodeSim, /pass\.setBindGroup\(3, transportPredictBindGroup\)/, 'main sim pass sets bind group 3');
  assert.match(source, /label: `kaminos first fluid sim compute pipeline \$\{gridSize\}\^3`,\s*layout: transportPipelineLayout,/, 'main sim pipeline uses the transport layout');
});
