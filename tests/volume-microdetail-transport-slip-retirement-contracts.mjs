import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

assert.doesNotMatch(core, /fn transportedScalarSlip\(/, 'the scalar/velocity disagreement operator is absent');
const microAdvection = sourceBetween(core, 'fn transportedMicrodetailAdvection(', 'fn interfaceShreddingForce(');
assert.doesNotMatch(
  microAdvection,
  /\b(?:proceduralTransportSlip|transportedScalarSlip|lateralSlipScale|rawSlip|slip)\b/,
  'microdetail follows transported velocity plus heat-derived lift without an independent slip vector',
);
assert.match(
  microAdvection,
  /let backCell = cell - \(velocity \+ lift\) \* \(1\.44 \+ speed \* 0\.28\);/,
  'microdetail retains its prior velocity/lift backtrace and changes only the retired slip term',
);
assert.match(
  core,
  /const MICRODETAIL_TRANSPORT_SLIP_RETIREMENT_IDENTITY = 'retired-microdetail-transport-slip-v0';/,
  'the removed operator has one stable retirement identity',
);
assert.match(core, /uniforms\[367\] = 0;/, 'the former ABI component is reserved at zero authority');
assert.match(core, /microdetailTransportSlipRetirementIdentity: MICRODETAIL_TRANSPORT_SLIP_RETIREMENT_IDENTITY/, 'the retirement identity is visible before the first frame');
assert.match(core, /state\.microdetailTransportSlipRetirementIdentity = MICRODETAIL_TRANSPORT_SLIP_RETIREMENT_IDENTITY;/, 'runtime state preserves the retirement identity');
assert.doesNotMatch(index, /id="volume-procedural-transport-slip"/, 'the retired operator is not presented as a live cockpit control');
assert.doesNotMatch(index, /volume_procedural_transport_slip/, 'the retired operator has no live route authority');
assert.equal(schema.controls.some(control => control.key === 'volume-procedural-transport-slip'), false, 'the retired control is absent from the active schema');
assert.deepEqual(
  schema.retiredControls.find(control => control.key === 'volume-procedural-transport-slip'),
  {
    axis: 'domControls',
    key: 'volume-procedural-transport-slip',
    param: 'volume_procedural_transport_slip',
    tagName: 'INPUT',
    type: 'checkbox',
  },
  'historical presets cross one explicit compatibility retirement boundary',
);
assert.equal(schema.controlCount, schema.controls.length, 'active schema count remains derived from its inventory');

console.log('volume microdetail transport slip: retired without changing base velocity/lift transport');
