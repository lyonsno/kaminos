// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRuntimeConfigLoader} from '../runtime-config-once.mjs';

const host=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const name of ['volume-core.js','volume-emitter-runtime.mjs','volume-emitter-basis.mjs']){
 test(`host and feature imports share the ${name} module instance`,async()=>{
  // Resolve the real host specifier, then let the module loader determine
  // identity. Comparing text alone would not expose duplicate module instances.
  const specifiers=[...host.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
  const specifier=specifiers.find(s=>new URL(s,new URL('../index.html',import.meta.url)).pathname.endsWith('/'+name));
  assert.ok(specifier,`host imports ${name}`);
  const hostModule=await import(new URL(specifier,new URL('../index.html',import.meta.url)));
  const featureModule=await import(new URL('../'+name,import.meta.url));
  assert.strictEqual(hostModule,featureModule,'host and feature dependencies must share one module instance');
 });
}
const defaultStatement=host.split('\n').find(line=>line.includes('authoringPromptUI.configureDefault(config.pup'));
assert.ok(defaultStatement,'startup config consumer exists');
test('Generate startup default adopts the shared early configuration request',async()=>{
 let calls=0,release;const response=new Promise(r=>release=r),values=[];
 const fetch=()=>{calls++;return response;};
 const scope={__kaminosEarlyRuntimeConfig:fetch()};
 const loadStartupRuntimeConfig=createRuntimeConfigLoader(fetch,scope);
 const existingConsumer=loadStartupRuntimeConfig();
 const applied=vm.runInNewContext(defaultStatement,{fetch,loadStartupRuntimeConfig,authoringPromptUI:{configureDefault:value=>values.push(value)},console});
 assert.equal(calls,1,'Generate must not issue another startup request');
 release({ok:true,json:async()=>({pup:{keepLoadedDefault:true}})});
 await Promise.all([existingConsumer,applied]);assert.deepEqual(values,[true]);
});
test('failed startup configuration keeps the default unset and reports the failure',async()=>{
 const warnings=[],values=[];const error=Error('configuration unavailable');
 const fetch=async()=>{throw error;};const loadStartupRuntimeConfig=createRuntimeConfigLoader(fetch,{});
 await vm.runInNewContext(defaultStatement,{fetch,loadStartupRuntimeConfig,authoringPromptUI:{configureDefault:value=>values.push(value)},console:{warn:(...args)=>warnings.push(args)}});
 assert.deepEqual(values,[]);assert.equal(warnings.length,1);assert.strictEqual(warnings[0][1],error);
});
