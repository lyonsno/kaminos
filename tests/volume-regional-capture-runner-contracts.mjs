// kaminos-test: node
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const out=await mkdtemp(path.join(tmpdir(),'regional-capture-failure-'));
try {
  const run=spawnSync(process.execPath,['scripts/capture-regional-optics.mjs','--out',out,
    '--root',path.join(out,'missing-source')],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.notEqual(run.status,0);
  const report=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));
  assert.equal(report.status,'failed');
  assert.equal(report.failurePhase,'inputs');
  assert.deepEqual(report.chunks,[]);
  assert.equal(report.dataset,undefined,'failure must not synthesize a default dataset');
} finally {await rm(out,{recursive:true,force:true});}
console.log('regional capture fails before acquisition with a durable phase report');

// Exercise the exact browser wait predicate with a valid two-object source.
const {regionalSceneLoaded}=await import('../volume-regional-state.mjs');
const savedWindow=globalThis.window,savedDocument=globalThis.document;
try {
  globalThis.window={kaminosSceneAuthoring:{read:()=>({objects:[{id:'flame-emitter'},{id:'flame-field'}]})}};
  globalThis.document={getElementById:()=>({textContent:''})};
  assert.equal(regionalSceneLoaded(['flame-emitter','flame-field']),true,'two-object saved scene must finish loading');
  assert.equal(regionalSceneLoaded(['flame-emitter','missing-domain']),false,'count alone cannot establish requested object identity');
  globalThis.document={getElementById:()=>({textContent:'Scene load failed: missing source'})};
  assert.throws(()=>regionalSceneLoaded(['flame-emitter','missing-domain']),/load failed/i);
} finally {
  if(savedWindow===undefined)delete globalThis.window;else globalThis.window=savedWindow;
  if(savedDocument===undefined)delete globalThis.document;else globalThis.document=savedDocument;
}

const malformedOut=await mkdtemp(path.join(tmpdir(),'regional-capture-arguments-'));
try {
  const run=spawnSync(process.execPath,['scripts/capture-regional-optics.mjs','--out',malformedOut,'--unknown-option','x'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.notEqual(run.status,0);
  const report=JSON.parse(await readFile(path.join(malformedOut,'report.json'),'utf8'));
  assert.equal(report.status,'failed');assert.equal(report.failurePhase,'arguments');
  assert.deepEqual(report.rawInvocation,['--out',malformedOut,'--unknown-option','x']);
} finally {await rm(malformedOut,{recursive:true,force:true});}

// Exercise the production acquisition barrier while IDs exist but restore is pending.
const {regionalSceneRestored}=await import('../volume-regional-state.mjs');
try {
 let resolve;globalThis.window={kaminosSceneLoadReady:()=>new Promise(r=>{resolve=r;})};
 let finished=false;const pending=regionalSceneRestored('regional-source.kaminos.json').then(value=>{finished=true;return value;});
 await new Promise(r=>setImmediate(r));assert.equal(finished,false);
 resolve({document:{filename:'regional-source.kaminos.json',phase:'idle',blocked:false}});await pending;
 window.kaminosSceneLoadReady=async()=>({document:{filename:'wrong.kaminos.json',phase:'idle',blocked:false}});
 await assert.rejects(regionalSceneRestored('regional-source.kaminos.json'), /wrong saved scene/);
 window.kaminosSceneLoadReady=async()=>({document:{filename:'regional-source.kaminos.json',phase:'applying',blocked:true}});
 await assert.rejects(regionalSceneRestored('regional-source.kaminos.json'), /restore incomplete/);
 window.kaminosSceneLoadReady=async()=>{throw Error('scene restore rejected');};
 await assert.rejects(regionalSceneRestored('regional-source.kaminos.json'), /restore rejected/);
} finally {
 if(savedWindow===undefined)delete globalThis.window;else globalThis.window=savedWindow;
}

const {regionalCaptureScene}=await import('../volume-regional-state.mjs');
const sceneFixture={objects:[{id:'source',transform:{scale:[2,2,2]},volumeMaterial:{settings:{temperature:{value:4}}}}],fireRendering:{rendererControls:{'volume-ray-start-noise':{value:true},'volume-integral-reconstruction':{value:'history'},'volume-history-window':{value:2}}}};
const before=structuredClone(sceneFixture),schema={rendererControls:[{key:'volume-ray-start-noise'}]};
const projected=regionalCaptureScene(sceneFixture,schema);
assert.deepEqual(sceneFixture,before);assert.deepEqual(projected.scene.objects,before.objects);
assert.deepEqual(projected.omittedRendererControls,Object.fromEntries(Object.entries(before.fireRendering.rendererControls).filter(([key])=>key!=='volume-ray-start-noise')));
assert.deepEqual(projected.scene.fireRendering.rendererControls,{'volume-ray-start-noise':{value:true}});
const unknown=structuredClone(sceneFixture);unknown.fireRendering.rendererControls['volume-unknown-material']={value:4};
assert.throws(()=>regionalCaptureScene(unknown,schema),/unsupported regional capture control/);
