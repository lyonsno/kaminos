// kaminos-test: node — GI proxy levels never cost the Generate result: once the hero mesh is stored, a levels
// failure of any kind (runner module fails to load, worker fails, dispatch throws) becomes a levels report
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createTrellisPageAuthoringGeneration} from '../authoring-trellis-page.mjs';
import {createTrellisAuthoringPersistence} from '../authoring-trellis-persistence.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const start=html.indexOf('const trellisPersistence='),end=html.indexOf('\n  // TRELLIS in this page',start);
// The page function, with its dynamic import routed through an injected loader.
const source=html.slice(start,end).replaceAll('await import(','await loadModule(');
const pagePersist=({loadModule,window})=>{let stored=0,heroSha;
  const request=async(url,options)=>{
    if(url.startsWith('/api/ingest-mesh')){
      const sha256=createHash('sha256').update(new Uint8Array(options.body)).digest('hex');
      return {ok:true,json:async()=>({sha256,bytes:options.body.byteLength,source:'/stored/'+sha256+'.glb'})};
    }
    const result=JSON.parse(options.body);stored++;heroSha=result.sha256;
    return {ok:true,json:async()=>({result})};
  };
  const create=options=>createTrellisAuthoringPersistence({...options,request,
    loadModule:specifier=>specifier==='./trellis-reconstruction.mjs'?import('../trellis-reconstruction.mjs'):loadModule(specifier)});
  const persist=new Function('createTrellisAuthoringPersistence','window','setInfo','console',`${source};return persistTrellisPageRun;`)(create,window,()=>{},{warn(){}});
  return {persist,stored:()=>stored,heroSha:()=>heroSha};};
const settle=()=>new Promise(r=>setTimeout(r,0));

for(const [name,loadModule] of [
  ['the levels runner module fails to load',async()=>{throw Error('simulated runner module fetch failure');}],
  ['the levels runner throws when launched',async()=>({runGenerationLevels(){throw Error('simulated dispatch failure');}})],
  ['the levels runner rejects',async()=>({runGenerationLevels:()=>Promise.reject(Error('simulated rejection'))})],
]){
  test(`after the hero is stored, Generate still succeeds when ${name}; the failure is a levels report for that hero`,async()=>{
    const window={},{persist,stored,heroSha}=pagePersist({loadModule,window});
    const service=createTrellisPageAuthoringGeneration({availability:()=>({status:'available'}),
      runPage:async()=>({glb:new ArrayBuffer(12),generation:{runId:'r'},levelInputs:{decode:{vertices:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2])},materialFields:{features:new Float32Array(6),coordinates:new Int32Array([1,1,1]),resolution:1024}}}),
      persist:(glb,generation,label,extra)=>persist({glb,generation,label,...extra})});
    await service.run({source:'/selected.png',label:'shoe'});
    const state=service.read();
    assert.equal(stored(),2);assert.equal(state.status,'complete');assert.equal(state.results.length,1);
    assert.ok(!state.pending);assert.equal(service.busy(),false);
    for(let i=0;i<5;i++)await settle();
    assert.equal(window.__kaminosLastGenerationLevels?.source,heroSha());
    assert.equal(window.__kaminosLastGenerationLevels?.phase,'worker');
    assert.match(window.__kaminosLastGenerationLevels?.error,/simulated/);
  });
}

test('persistTrellisPageRun builds GI proxy levels from heroGLB even when levelInputs is absent, and kaminosTrellisPage awaits levels by default',async()=>{
  const calls=[];
  const window={};
  const {persist,heroSha}=pagePersist({
    window,
    loadModule:async()=>({
      runGenerationLevels:async args=>{
        calls.push(args);
        await new Promise(r=>setTimeout(r,10));
        return {phase:'done',tiers:[{faces:25000},{faces:10000},{faces:5000},{faces:1000},{faces:500}]};
      },
    }),
  });
  const glb=new Uint8Array([0x67,0x6c,0x54,0x46,2,0,0,0,12,0,0,0]).buffer;
  await persist({glb,generation:{runId:'r-fallback',route:'trellis2.image-generation.webgpu.v0'},label:'kiln',levelInputs:null});
  assert.ok(window.__kaminosLastGenerationLevelsPromise,'levels promise exposed for headless callers');
  const report=await window.__kaminosLastGenerationLevelsPromise;
  assert.equal(calls.length,1,'runGenerationLevels called from heroGLB when levelInputs is null');
  assert.equal(calls[0].source,heroSha());
  assert.ok(calls[0].heroGLB instanceof Uint8Array && calls[0].heroGLB.byteLength===12);
  assert.equal(report.phase,'done');
  assert.match(html,/window\.kaminosTrellisPage=async options=>\{[\s\S]*await window\.__kaminosLastGenerationLevelsPromise/,'window.kaminosTrellisPage awaits levels promise unless disabled');
  const trellisStart=html.indexOf('const trellis=()=>{');
  const trellisBody=html.slice(trellisStart,trellisStart+3000);
  assert.match(trellisBody,/runGenerationLevels\(\{heroGLB,source/,'queued trellis() persist triggers runGenerationLevels from heroGLB');
});
