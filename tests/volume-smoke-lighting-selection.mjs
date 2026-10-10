import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as physical from '../volume-physical-color.mjs';
import * as emissive from '../volume-emissive-transport.mjs';
import * as scene from '../scene-volume-source.mjs';
import * as outer from '../volume-outer-smoke.mjs';
import {SCENE_POINT_SMOKE_WGSL} from '../scene-point-light.mjs';
import {DISTRIBUTED_SMOKE_WGSL} from '../scene-volume-gather.mjs';
import * as lighting from '../volume-smoke-lighting.mjs';

const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const context={...physical,...emissive,...scene,...outer,...lighting,SCENE_POINT_SMOKE_WGSL,DISTRIBUTED_SMOKE_WGSL,
  FIRE_LICK_BREAKUP_BYPASS_THRESHOLD:0.0005};
export function shaderVariants(extra={}) {
  const ctx=vm.createContext({...context,...extra});
  vm.runInContext(source.slice(source.indexOf('const WGSL ='),source.indexOf('const ANALYTIC_EMITTER_INJECTION_WGSL')),ctx);
  const active=source.slice(source.indexOf('  function activeVolumeShader()'),source.indexOf('  let volumePresentationModeRequestedRaw'));
  const point=source.match(/let code\s*=([^;]+SCENE_POINT_SMOKE_WGSL);/)[1];
  const distributed=source.match(/let code\s*=([^;]+DISTRIBUTED_SMOKE_WGSL);/)[1];
  const result=[];
  for(const enabled of [false,true]) {
    ctx.outerRequested=enabled;ctx.outerConfig={extent:5};vm.runInContext(active,ctx);
    for(const [route,expr] of [['legacy','activeVolumeShader()'],['point',point],['distributed',distributed]])
      result.push({route,enabled,code:vm.runInContext(expr,ctx)});
  }
  return result;
}
export function reachableFunctions(code,entry) {
  const bodies=new Map();
  for(const match of code.matchAll(/\bfn\s+(\w+)\s*\([^]*?\{/g)) {
    let at=match.index+match[0].length,depth=1,end=at;
    while(depth&&end<code.length){if(code[end]==='{')depth++;if(code[end]==='}')depth--;end++;}
    bodies.set(match[1],code.slice(at,end-1));
  }
  const seen=new Set();function visit(name){if(seen.has(name)||!bodies.has(name))return;seen.add(name);
    for(const call of bodies.get(name).matchAll(/\b(\w+)\s*\(/g))visit(call[1]);}
  visit(entry);return seen;
}
for(const {route,enabled,code} of shaderVariants()) {
  const calls=reachableFunctions(code,'fs');
  if(route==='distributed')assert(calls.has('distributedMeanIncident'),'selected distributed shader must actually consume distributed incident light');
  if(route==='point')assert(calls.has('scenePointIncident'),'selected point shader must actually consume point light');
  const incident=reachableFunctions(code,'smokeIncidentAt');
  assert.equal(incident.has('incidentAt'),route!=='distributed','distributed must not stack legacy lighting');
  assert.equal(incident.has('scenePointIncident'),route==='point');
  assert.equal(incident.has('distributedMeanIncident'),route==='distributed');
  assert.match(code,/medium\.scattering\s*\*\s*smokeIncidentAt\(p,sigma\)/);
  assert.equal([...code.matchAll(/medium\.scattering\s*\*\s*smokeIncidentAt\(p,sigma\)/g)].length,2,'fine and exterior marches share the selected consumer');
  assert(code.includes(`const OUTER_SMOKE: bool = ${enabled};`),'lighting variants must retain effective outer enable');
  assert(code.includes('const OUTER_EXTENT: f32 = 5.000000000;'),'lighting variants must retain effective outer extent');
}
const {selectSmokeLightingShader:select,SMOKE_INCIDENT_WGSL:consumer}=lighting;
assert.throws(()=>select('', 'distributed'),/exactly one/);
assert.throws(()=>select(consumer+consumer, 'point'),/exactly one/);
assert.throws(()=>select(consumer.replace('joinedSmokeIncidentAt','changed'), 'point'),/exactly one/);
assert.throws(()=>select(consumer,'unknown'),/unknown/);
console.log('actual lighting variants retain domain configuration and consume selected light');
