// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
import {readOwnerExperimentAddress} from '../owner-experiment-entry.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('// --- Init ---'),html.indexOf('sceneInitialization.then(async () => {'))
  +'\nglobalThis.initialization=sceneInitialization;';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const preset='vsp-'+'a'.repeat(64);
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:preset,stationary:true},route:{volume_light_field:'1'},lightGainStops:0};
function fixture({matching=false,missing=false,ordinary=false,earlyScene=null}={}){
 const events=[];let release;
 const response=new Promise(resolve=>release=resolve);
 const c={URLSearchParams,Symbol,Promise,compositionRestoreUrl,readOwnerExperimentAddress,window:{__kaminosEarlySceneText:earlyScene},
  location:{origin:'http://localhost',hash:ordinary?'':'#scene=chosen.kaminos.json&workspace=workbench',search:matching?'?settings_preset='+preset:'',replace:url=>events.push(['redirect',url])},
  fetch:()=>{events.push(['fetch']);return response;},planSceneRestore:()=>({composition}),
  sceneDocument:{holdRestore(){events.push(['hold']);}},setInfo(){},document:{},
  grInit(){},initKaminosFingerFluidBenchRoute(){},initKaminosFingerJuiceHostRoute(){},
  initScene:()=>{events.push(['viewer']);return Promise.resolve();},settleStartupVeil:(_document,promise)=>promise,
 };
 vm.runInNewContext(code,c);c.initialization.catch(()=>{});
 return {events,c,release:()=>release({ok:!missing,json:async()=>({version:8}),text:async()=>'{"version":8}'})};
}
test('saved recipe recovery allocates no discarded 3D viewer',async()=>{
 const f=fixture();await flush();
 assert.equal(f.events.some(e=>e[0]==='viewer'),false,'viewer initialization must wait for saved recipe admission');
 f.release();await f.c.initialization;
 assert.equal(f.events.filter(e=>e[0]==='redirect').length,1);
 assert.equal(f.events.some(e=>e[0]==='viewer'),false);
});
test('matching saved recipe starts exactly one viewer after document admission',async()=>{
 const f=fixture({matching:true});f.release();await f.c.initialization;
 assert.deepEqual(f.events.map(e=>e[0]),['fetch','hold','viewer']);
});
test('missing saved document never allocates a viewer',async()=>{
 const f=fixture({missing:true});f.release();await assert.rejects(f.c.initialization,/Scene unavailable/);
 assert.equal(f.events.some(e=>e[0]==='viewer'),false);
});
test('ordinary startup has no scene fetch prerequisite',async()=>{
 const f=fixture({ordinary:true});await f.c.initialization;
 assert.deepEqual(f.events,[['viewer']]);
});

test('module startup adopts the exact early scene body without a second request',async()=>{
 const f=fixture({matching:true,earlyScene:{filename:'chosen.kaminos.json',text:Promise.resolve('{"version":8}')}});await flush();
 assert.equal(f.events.filter(e=>e[0]==='fetch').length,0,'already downloading scene is shared with module admission');await f.c.initialization;assert.equal(f.events.filter(e=>e[0]==='viewer').length,1);assert.equal(f.c.window.__kaminosEarlySceneText,null);
});
test('mismatched early scene cannot replace the requested document',async()=>{
 const f=fixture({matching:true,earlyScene:{filename:'other.kaminos.json',text:Promise.resolve('wrong')}});f.release();await f.c.initialization;assert.equal(f.events.filter(e=>e[0]==='fetch').length,1);
});
