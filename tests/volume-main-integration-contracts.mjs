import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const binding = name => {
  const match = core.match(new RegExp('@group\\((\\d+)\\) @binding\\((\\d+)\\) var<storage, [^>]+> ' + name + ':'));
  assert.ok(match, `GPU binding exists for ${name}`);
  return `${match[1]}:${match[2]}`;
};
const names = ['quenchSrc', 'quenchDst', 'nonRidgeOpticalCaptureHeader', 'nonRidgeOpticalCaptureRows'];
assert.equal(new Set(names.map(binding)).size, names.length,
  'quench ping-pong and optical capture must use four distinct GPU bindings');

const helper = core.match(/  function createFluidRenderBindGroup\([\s\S]*?\n  }\n/)?.[0];
assert.ok(helper, 'one shared fluid binding constructor');
const buffer = label => ({ label });
const quenchBuffers = [buffer('quench A'), buffer('quench B')];
const resources = {
  device: { createBindGroup: descriptor => descriptor }, bindGroupLayout: {},
  uniformBuffer: buffer('uniform'), externalEmitterBuffer: buffer('emitter'),
  oracleActivityCueBuffer: buffer('oracle'), boundarySidecarBuffer: buffer('sidecar'),
  nonRidgeOpticalCaptureHeaderBuffer: buffer('capture header'),
  emissiveLightField: { incident: buffer('incident') }, quenchBuffers,
};
const makeGroup = new Function(...Object.keys(resources), `${helper}; return createFluidRenderBindGroup;`)(...Object.values(resources));
for (let q = 0; q < 2; q++) {
  const captureRows = buffer(`capture ${q}`);
  const group = makeGroup({ label: 'composition', fluidRead: buffer('fluid'), fluidWrite: buffer('next'),
    frontRead: buffer('front'), frontWrite: buffer('next front'), captureRows,
    quenchRead: quenchBuffers[q], quenchWrite: quenchBuffers[1 - q] });
  const entry = name => group.entries.find(e => e.binding === Number(binding(name).split(':')[1]))?.resource.buffer;
  assert.equal(entry('quenchSrc'), quenchBuffers[q]);
  assert.equal(entry('quenchDst'), quenchBuffers[1 - q]);
  assert.equal(entry('nonRidgeOpticalCaptureRows'), captureRows);
  assert.equal(entry('nonRidgeOpticalCaptureHeader'), resources.nonRidgeOpticalCaptureHeaderBuffer);
}
assert.match(core, /function fluidBindGroup\([\s\S]*?return bindGroups\[fluidIndex \* 2 \+ quenchIndex\]/,
  'simulation consumes both independent ping-pong indices');
assert.doesNotMatch(core, /\bbindGroups\[currentFluid\]/, 'no single-index consumer of four fluid/quench groups');
assert.doesNotMatch(core, /let flowDebug = clamp\(u\.boundary_fire_display\.y/,
  'flow debug must not consume the intrinsic presentation flag');
console.log('PASS: main quench and emissive capture integration contracts');
