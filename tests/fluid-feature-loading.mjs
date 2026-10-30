// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const hostURL=new URL('../index.html',import.meta.url);
const host=readFileSync(hostURL,'utf8');
const source=host.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const imports=JSON.parse(host.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
function staticDependencies(source){
 const result=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',`
 import {SourceTextModule} from 'node:vm';
 import {readFileSync} from 'node:fs';
 const {source,base,imports}=JSON.parse(readFileSync(0,'utf8'));
 const seen=new Set(),external=new Set();
 function walk(source,url){
  for(let specifier of new SourceTextModule(source,{identifier:url}).dependencySpecifiers){
   if(imports[specifier])specifier=new URL(imports[specifier],base).href;
   else for(const [prefix,target] of Object.entries(imports))if(prefix.endsWith('/')&&specifier.startsWith(prefix)){specifier=new URL(target+specifier.slice(prefix.length),base).href;break;}
   const next=new URL(specifier,url);
   if(next.protocol!=='file:'){external.add(next.href);continue;}
   if(seen.has(next.href))continue;seen.add(next.href);walk(readFileSync(next,'utf8'),next.href);
  }
 }
 walk(source,base);console.log(JSON.stringify({local:[...seen],external:[...external]}));
 `],{input:JSON.stringify({source,base:hostURL.href,imports}),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return JSON.parse(result.stdout);
}
test('ordinary host dependency graph excludes the fluid solver and analytic bench implementation',()=>{
 const graph=staticDependencies(source);
 for(const name of ['finger-fluid-webgpu-core.js','finger-fluid-analytic-impact-handoff.js']){
  assert.ok(!graph.local.includes(new URL('../'+name,import.meta.url).href),`${name} is an eager ordinary-opening dependency`);
 }
 // A regression through an indirect import must be visible to this check.
 const poisoned=staticDependencies(source+"\nimport './finger-fluid-analytic-impact-handoff.js';");
 assert.ok(poisoned.local.includes(new URL('../finger-fluid-webgpu-core.js',import.meta.url).href));
});

test('the explicit bench route alone imports its runtime; load failures propagate',()=>{
 const result=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',`
 import assert from 'node:assert/strict';
 import {SourceTextModule} from 'node:vm';
 import {readFileSync} from 'node:fs';
 const url=new URL('./finger-fluid-feature.mjs',${JSON.stringify(new URL('../',import.meta.url).href)});
 const requested=[];let fail=false;
 const module=new SourceTextModule(readFileSync(url,'utf8'),{identifier:url.href,importModuleDynamically:async specifier=>{
  requested.push(specifier);if(fail)throw Error('runtime unavailable');return import(new URL(specifier,url));
 }});
 await module.link(()=>{throw Error('feature gate must not statically import runtime');});await module.evaluate();
 for(const query of ['', 'kaminos_finger_fluid_bench=0', 'kaminos_finger_fluid_bench=true']){
  assert.deepEqual(Object.keys(await module.namespace.loadFingerFluidBenchFeature(new URLSearchParams(query))),[]);
 }
 assert.deepEqual(requested,[]);
 const feature=await module.namespace.loadFingerFluidBenchFeature(new URLSearchParams('kaminos_finger_fluid_bench=1'));
 assert.deepEqual(requested.sort(),['./finger-fluid-analytic-impact-handoff.js','./finger-fluid-webgpu-core.js']);
 const runtime=await module.namespace.loadFingerFluidRuntime();
 assert.equal(feature.createWebGPUFingerFluidSolver,runtime.createWebGPUFingerFluidSolver);
 assert.equal(typeof feature.createFingerFluidAnalyticJetDescriptor,'function');
 fail=true;await assert.rejects(module.namespace.loadFingerFluidBenchFeature(new URLSearchParams('kaminos_finger_fluid_bench=1')),/runtime unavailable/);
 `],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});

test('editor and solver share one geometry function without sharing mutable snapshots',async()=>{
 const editor=await import('../finger-fluid-support-geometry.mjs');
 const solver=await import('../finger-fluid-webgpu-core.js');
 assert.strictEqual(editor.fingerFluidAnalyticalSupportGeometry,solver.fingerFluidAnalyticalSupportGeometry);
 const original={boundsMin:[-3.4,-1.2,-3.4],boundsMax:[3.4,3,3.4],obstacle:{center:[.85,-.43,.02],radius:.52}};
 assert.deepEqual(editor.fingerFluidAnalyticalSupportGeometry(),original);
 const edited=editor.fingerFluidAnalyticalSupportGeometry();edited.boundsMin[0]=99;edited.boundsMax[0]=99;edited.obstacle.center[0]=99;edited.obstacle.radius=99;
 assert.deepEqual(solver.fingerFluidAnalyticalSupportGeometry(),original);
});
