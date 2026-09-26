import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

// Execute the production backtrace expressions and actual mode branch, with
// recording samplers. This is CPU routing/arithmetic evidence, not WGSL or GPU
// execution and not a transport-conservation or visual-quality oracle.
function functionBody(name) {
  const start = core.indexOf(`fn ${name}(`);
  assert.notEqual(start, -1, `production helper ${name} exists`);
  const open = core.indexOf('{', start);
  let depth = 1;
  let end = open + 1;
  while (depth && end < core.length) {
    if (core[end] === '{') depth++;
    if (core[end] === '}') depth--;
    end++;
  }
  const args = core.slice(start + `fn ${name}(`.length, core.indexOf(') ->', start))
    .replace(/:\s*(vec[34]<f32>|f32)/g, '');
  return `function ${name}(${args}) ${core.slice(open, end)}`;
}

function translate(source) {
  return source
    .replace(/vec[34]<f32>/g, 'vec')
    .replace(/\b(\d+)u\b/g, '$1')
    .replace(/cell - \(velocity \+ (\w+)\) \* (\([^;]+\))/g, 'backtrace(cell, add(velocity, $1), $2)')
    .replace(/cell - advectVelocity \* (\([^;]+\)|\w+)/g, 'backtrace(cell, advectVelocity, $1)');
}

const helpers = ['transportBacktraceScale', 'thermalAdvection', 'fireLayerAdvection', 'transportedMicrodetailAdvection']
  .map(functionBody).join('\n');
// The MacCormack predictor kernel shares the backtrace expression, so anchor
// inside the main sim kernel rather than at the first occurrence in the file.
const mainKernelStart = core.indexOf('\nfn cs(@builtin(global_invocation_id) gid: vec3<u32>) {');
assert.notEqual(mainKernelStart, -1, 'main sim kernel is located');
const mainStart = core.indexOf('  let backtraceScale = transportBacktraceScale(speed)', mainKernelStart);
const mainEnd = core.indexOf('  if (bonfireScene > 0.5)', mainStart);
assert.ok(mainStart >= 0 && mainEnd > mainStart, 'production advection block is located');
const run = new Function('cell', 'advectVelocity', 'speed', 'heat', 'enabled', `
  const calls = [];
  const vec = (x, y = x, z = x, w = x) => ({x,y,z,w});
  const add = (a,b) => vec(a.x+b.x, a.y+b.y, a.z+b.z);
  const backtrace = (c,v,s) => vec(c.x-v.x*s, c.y-v.y*s, c.z-v.z*s);
  const clamp = (v,lo,hi) => Math.min(hi, Math.max(lo,v));
  const cellI = cell;
  // transport_controls.x = 0 selects the legacy scheme, so this exercises the
  // first-order branch that the common-gas switch routes.
  const u = {reserved_source_extension_2:{y:enabled ? 1 : 0}, transport_controls:{x:0}};
  // timeStep is 1 and stepRate is the identity under the legacy time-step
  // mode this block is exercised in.
  const timeStep = 1;
  const stepRate = rate => rate;
  const thermalAdvectionRiseDirection = 1, fireLayerRiseDirection = 1, microdetailRiseDirection = 1;
  const readSlot = () => vec(0.4,heat,0.3,0.2);
  const sampleFluidSlot = (p,slot) => {calls.push({slot,p:[p.x,p.y,p.z]}); return vec(0.4,heat,0.3,0.2);};
  const sampleFrontField = p => {calls.push({slot:'front',p:[p.x,p.y,p.z]}); return 0.5;};
  ${translate(helpers)}
  ${translate(core.slice(mainStart, mainEnd))}
  return calls;
`);
const at = {x:30.5,y:40.5,z:20.5};
const moving = {x:0.2,y:0.3,z:-0.1};
const near = (actual, expected) => actual.forEach((v,i) => assert.ok(Math.abs(v-expected[i]) < 1e-12, `${actual} != ${expected}`));

test('common transport samples all gas state and front at the velocity backtrace', () => {
  for (const speed of [0.1, 2.5, 5]) {
    const rows = run(at, moving, speed, 1.4, true);
    assert.deepEqual(rows.map(row => row.slot), [0,1,2,3,'front']);
    for (const row of rows) near(row.p, rows[0].p);
  }
});

test('hot stationary gas has no per-layer kinematic rise in common mode', () => {
  const rows = run(at, {x:0,y:0,z:0}, 5, 1.7, true);
  for (const row of rows) near(row.p, [at.x,at.y,at.z]);
});

test('legacy mode preserves the original distinct backtraces and lift', () => {
  const speed = 2.5, heat = 1.4;
  const rows = run(at, moving, speed, heat, false);
  const position = (scale,lift) => [at.x-moving.x*scale,at.y-(moving.y+lift)*scale,at.z-moving.z*scale];
  near(rows[0].p, position(2.55+speed*0.55,0));
  near(rows[1].p, position(2.30+speed*0.46,heat*(0.24+speed*0.055)));
  near(rows[2].p, position(1.82+speed*0.34,heat*(0.40+speed*0.13)));
  near(rows[3].p, position(1.44+speed*0.28,(heat*0.22+0.4*0.34)*(0.28+speed*0.055)));
  near(rows[4].p, rows[0].p);
});

test('control is persisted default-legacy and connected to the live shader branch', () => {
  const control = schema.controls.find(control => control.key === 'volume-common-gas-transport');
  assert.ok(control, 'canonical preset schema exposes the transport choice');
  assert.equal(control.additiveDefault, false);
  assert.equal(control.type, 'checkbox');
  assert.equal(control.param, 'volume_common_gas_transport');
  assert.match(index, /commonGasTransport: document\.getElementById\('volume-common-gas-transport'\)\.checked/);
  assert.match(index, /\['volume-common-gas-transport', 'volume_common_gas_transport'\]/);
  assert.match(core, /uniforms\[353\] = controlsSnapshot\.commonGasTransport === true \? 1 : 0/);
  assert.match(core.slice(mainStart, mainEnd), /u\.reserved_source_extension_2\.y > 0\.5/);
  assert.match(core, /gasTransport: state\.gasTransport/);
});
