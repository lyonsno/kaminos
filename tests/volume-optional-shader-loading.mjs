// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
// Execute the production shader-acquisition block with a recording device.
// This asserts allocation lifetime only, not WGSL behavior or compilation speed.
const start=source.indexOf("    shader = device.createShaderModule({ label: 'kaminos compute fluid raymarch wgsl'");
const end=source.indexOf('    bindGroupLayout = device.createBindGroupLayout({',start);
assert.ok(start>=0&&end>start);
test('cold ordinary flame prepares only the two required shader modules',async()=>{
 const created=[];
 const c={state:{},device:{createShaderModule:descriptor=>{created.push(descriptor.label);return{getCompilationInfo:async()=>({messages:[]})};}},
 WGSL:'fluid-code',ANALYTIC_EMITTER_INJECTION_WGSL:'analytic-code',BROWSER_RESIDUAL_WGSL:'residual-code',BOUNDARY_SPLAT_WGSL:'splat-code',BOUNDARY_SPLAT_PRESENTATION_WGSL:'resolve-code',BOUNDARY_SPLAT_OPTICAL_PRESENTATION_WGSL:'optical-code',
 FOUR_ARM_HELD_STATE_LINEAR_RESOLVE_WGSL:'four-arm-resolve-code',FOUR_ARM_HELD_STATE_RESIDUAL_MARCH_WGSL:'four-arm-residual-code',FOUR_ARM_HELD_STATE_TIMESTAMP_MARKER_WGSL:'four-arm-marker-code',
 BOUNDARY_SPLAT_RENDERER_IDENTITY:'splats',BOUNDARY_SPLAT_PRESENTATION_RESOLVE_IDENTITY:'splat-resolve',BOUNDARY_SPLAT_OPTICAL_TRANSPORT_IDENTITY:'splat-optical'};
 vm.createContext(c);await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',c);
 assert.deepEqual(created,['kaminos compute fluid raymarch wgsl','kaminos bounded analytic emitter injection wgsl'],'inactive optional renderers must not charge every first flame');
});


function lazyFixture(messages=[]){
 const created=[],reported=[];
 const device=()=>({createShaderModule:descriptor=>{const module={descriptor,getCompilationInfo:async()=>({messages})};created.push(module);return module;}});
 const c={device:device(),state:{},emitStatus:value=>reported.push(value),Map,
 BROWSER_RESIDUAL_WGSL:'residual-code',BOUNDARY_SPLAT_WGSL:'splat-code',BOUNDARY_SPLAT_PRESENTATION_WGSL:'resolve-code',BOUNDARY_SPLAT_OPTICAL_PRESENTATION_WGSL:'optical-code',FOUR_ARM_HELD_STATE_LINEAR_RESOLVE_WGSL:'four-arm-resolve-code',FOUR_ARM_HELD_STATE_RESIDUAL_MARCH_WGSL:'four-arm-residual-code',FOUR_ARM_HELD_STATE_TIMESTAMP_MARKER_WGSL:'four-arm-marker-code',BOUNDARY_SPLAT_RENDERER_IDENTITY:'splats',BOUNDARY_SPLAT_PRESENTATION_RESOLVE_IDENTITY:'splat-resolve',BOUNDARY_SPLAT_OPTICAL_TRANSPORT_IDENTITY:'splat-optical'};
 const begin=source.indexOf('  const optionalShaderModules = new Map();'),finish=source.indexOf('  const optionalPipelines =',begin);
 assert.ok(begin>=0&&finish>begin);vm.createContext(c);vm.runInContext(source.slice(begin,finish)+';this.get=optionalShaderModule;this.entries=optionalShaderModules;this.names=Object.keys(optionalShaderDescriptors);',c);
 return{c,created,reported,device};
}
test('optional shader modules are created on actual demand and shared across pipelines on that device',async()=>{
 const {c,created}=lazyFixture();assert.equal(created.length,0);
 for(const name of c.names){const first=c.get(name);assert.equal(c.get(name),first);}
 assert.equal(created.length,7);await Promise.all([...c.entries.values()].map(e=>e.validation));assert.equal(c.state.error,undefined);
});
test('replacement devices get their own modules and stale compile failures cannot poison the new device',async()=>{
 let fail;const {c,device,reported}=lazyFixture();c.device.createShaderModule=()=>({getCompilationInfo:()=>new Promise((resolve,reject)=>{fail=reject;})});
 const old=c.get('browserResidualShader');c.device=device();const current=c.get('browserResidualShader');assert.notEqual(current,old);fail(Error('retired device compile'));await new Promise(r=>setImmediate(r));assert.deepEqual(reported,[]);
});
test('first-use compile errors retain detailed GPU error reporting and unknown modules fail loudly',async()=>{
 const {c,reported,created}=lazyFixture([{type:'error',lineNum:3,linePos:5,message:'invalid selected shader'}]);
 assert.throws(()=>c.get('missing-module'),/Unknown optional volume shader/);assert.equal(created.length,0);
 c.get('browserResidualShader');await Promise.all([...c.entries.values()].map(e=>e.validation));assert.equal(reported.length,1);assert.equal(reported[0].phase,'gpu-error');assert.match(reported[0].error,/3:5 invalid selected shader/);
});
