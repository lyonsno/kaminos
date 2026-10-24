// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('addMesh:async entry=>{',html.indexOf('authoringAssets=createAuthoringAssets'));
const fn=html.slice(start+'addMesh:'.length,html.indexOf('\n    }});',start)+6);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
for(const phase of ['fetch','bytes'])test(`asset Add cannot insert into another scene after ${phase}`,async()=>{
 let generation=1,imports=0;const gate=deferred();
 const add=vm.runInNewContext('('+fn+')',{File,workingScene:{arrival(){const own=generation;return {assertCurrent(){if(generation!==own)throw Error('Scene changed');}};}},fetch:async()=>{if(phase==='fetch')await gate.promise;return {ok:true,arrayBuffer:async()=>{if(phase==='bytes')await gate.promise;return new ArrayBuffer(4);}};},importSceneMesh:async()=>{imports++;}});
 const pending=add({name:'crown-ring.glb',source:'./assets/burners/crown-ring.glb'});await Promise.resolve();generation++;gate.resolve();await assert.rejects(pending,/Scene changed/);assert.equal(imports,0);
});
