// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as flame from '../flame-authoring.mjs';
test('emitter quick properties expose shared appearance, chemistry and immediate motion',()=>{
  const groups=flame.FLAME_EMITTER_QUICK_GROUPS;
  assert.ok(Array.isArray(groups),'emitter has explicitly grouped shared quick properties');
  const ids=groups.flatMap(g=>g.fields.map(([id])=>id));
  for(const id of ['volume-physical-exposure','volume-physical-kelvin-per-heat','volume-density','volume-physical-smoke-extinction','volume-physical-smoke-albedo','volume-physical-clean','volume-reaction-boundary-contrast','volume-reaction-law','volume-physical-material-law','volume-reactant-mixing-time','volume-reactant-cooling-time','volume-heat-release-expansion','volume-physical-soot-burnout-rate','volume-physical-soot-burnout-kelvin','volume-emitter-inlet-turbulence-scale','volume-emitter-puff','volume-emitter-puff-period','volume-wind-model','volume-wind-strength'])assert.ok(ids.includes(id),id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(!ids.includes('volume-wind-angle')&&!ids.includes('volume-wind-gust'));
});
test('either reactive law selection activates its compatible simulation/emission pair',()=>{
  assert.equal(typeof flame.flameReactiveSelection,'function');
  const pair={'volume-reaction-law':'reactant-v0','volume-physical-material-law':'2','volume-physical-mode':'2'};
  assert.deepEqual(flame.flameReactiveSelection('volume-reaction-law','reactant-v0'),pair);
  assert.deepEqual(flame.flameReactiveSelection('volume-physical-material-law','2'),pair);
  assert.deepEqual(flame.flameReactiveSelection('volume-physical-exposure','2'),{});
  assert.deepEqual(flame.flameReactiveSelection('volume-reaction-law','authored-tall-plume'),{});
  assert.deepEqual(flame.flameReactiveSelection(null,null),{},'bulk restoration must not silently rewrite saved choices');
});
