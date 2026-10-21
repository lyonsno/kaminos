// kaminos-test: node — GI proxy levels never cost the Generate result: once the hero mesh is stored, a levels
// failure of any kind (runner module fails to load, worker fails, dispatch throws) becomes a levels report
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createTrellisPageAuthoringGeneration} from '../authoring-trellis-page.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const start=html.indexOf('const persistTrellisPageRun=async out=>{'),end=html.indexOf('\n  // TRELLIS in this page',start);
// The page function, with its dynamic import routed through an injected loader.
const source=html.slice(start,end).replaceAll('await import(','await loadModule(');
const pagePersist=({loadModule,window})=>{let stored=0;
  const persist=new Function('persistGeneratedMesh','sha256Of','window','setInfo','console','loadModule',`${source};return persistTrellisPageRun;`)(
    async()=>{stored++;return {sha256:'a'.repeat(64),source:'/stored-hero.glb'};},async()=>'',window,()=>{},{warn(){}},loadModule);
  return {persist,stored:()=>stored};};
const settle=()=>new Promise(r=>setTimeout(r,0));

for(const [name,loadModule] of [
  ['the levels runner module fails to load',async()=>{throw Error('simulated runner module fetch failure');}],
  ['the levels runner throws when launched',async()=>({runGenerationLevels(){throw Error('simulated dispatch failure');}})],
  ['the levels runner rejects',async()=>({runGenerationLevels:()=>Promise.reject(Error('simulated rejection'))})],
]){
  test(`after the hero is stored, Generate still succeeds when ${name}; the failure is a levels report for that hero`,async()=>{
    const window={},{persist,stored}=pagePersist({loadModule,window});
    const service=createTrellisPageAuthoringGeneration({availability:()=>({status:'available'}),
      runPage:async()=>({glb:new ArrayBuffer(12),generation:{runId:'r'},levelInputs:{}}),
      persist:(glb,generation,label,extra)=>persist({glb,generation,label,...extra})});
    await service.run({source:'/selected.png',label:'shoe'});
    const state=service.read();
    assert.equal(stored(),1);assert.equal(state.status,'complete');assert.equal(state.results.length,1);
    assert.ok(!state.pending);assert.equal(service.busy(),false);
    for(let i=0;i<5;i++)await settle();
    assert.equal(window.__kaminosLastGenerationLevels?.source,'a'.repeat(64));
    assert.equal(window.__kaminosLastGenerationLevels?.phase,'worker');
    assert.match(window.__kaminosLastGenerationLevels?.error,/simulated/);
  });
}
