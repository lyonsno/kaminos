// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as flame from '../flame-authoring.mjs';
import {readFileSync} from 'node:fs';
test('emitter quick properties expose shared appearance, chemistry and immediate motion',()=>{
  const groups=flame.FLAME_EMITTER_QUICK_GROUPS;
  assert.ok(Array.isArray(groups),'emitter has explicitly grouped shared quick properties');
  const ids=groups.flatMap(g=>g.fields.map(([id])=>id));
  for(const id of ['volume-physical-exposure','volume-physical-kelvin-per-heat','volume-density','volume-physical-smoke-extinction','volume-physical-smoke-albedo','volume-physical-clean','volume-reaction-law','volume-reactant-mixing-time','volume-reactant-cooling-time','volume-heat-release-expansion','volume-physical-soot-burnout-rate','volume-physical-soot-burnout-kelvin','volume-emitter-inlet-turbulence-scale','volume-emitter-puff','volume-emitter-puff-period','volume-wind-model','volume-wind-strength'])assert.ok(ids.includes(id),id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(!ids.includes('volume-wind-angle')&&!ids.includes('volume-wind-gust'));
});
test('quick controls resolve to live controls after main retires alternate emission laws',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const ids=flame.FLAME_EMITTER_QUICK_GROUPS.flatMap(g=>g.fields.map(([id])=>id));
  for(const id of ids)assert.ok(html.includes(`id="${id}"`),`live control ${id}`);
  for(const id of ['volume-physical-material-law','volume-physical-mode','volume-reaction-boundary-contrast'])assert.ok(!ids.includes(id),`retired control ${id}`);
});
