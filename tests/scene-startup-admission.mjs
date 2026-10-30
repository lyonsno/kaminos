// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fireAtBoot} from '../fire-boot.mjs';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
import {readOwnerExperimentAddress} from '../owner-experiment-entry.mjs';
const html=readFileSync(process.env.KAMINOS_STARTUP_TEST_INDEX||new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('  const startupSceneRedirect =');
// Include fire initialization on the old implementation, which precedes scene acquisition.
const oldStart=html.lastIndexOf('  const fireBoot =',start);
const begin=oldStart>=0?oldStart:start;
const end=html.indexOf('  startupSceneRestore.catch',start);
const code=html.slice(begin,end)+';globalThis.result=startupSceneRestore;';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+'a'.repeat(64),label:'Saved tuning',stationary:true},route:{volume_light_field:'1',volume_light_field_scene_depth:'1'},lightGainStops:0};
function fixture({matching=false,failed=false,ordinary=false}={}){
 const environment=deferred(),volume=deferred(),events=[];
 const controls={disabled:false};const c={URLSearchParams,Promise,Symbol,fireAtBoot,compositionRestoreUrl,readOwnerExperimentAddress,window:{location:{search:'?settings_preset=vsp-test'}},ownerVolumeReady:null,activeVolumeSettingsPresetReceipt:{},volumeSettingsPresetStatus:message=>events.push(['preset-failure',message]),console:{error(){}},
 location:{origin:'http://localhost',hash:ordinary?'':'#workspace=workbench&scene=chosen.kaminos.json',search:matching?'?settings_preset='+composition.flame.presetId:'',replace:url=>events.push(['redirect',url])},
 environmentLoaded:environment.promise,initKaminosVolumeRoute(){events.push(['boot']);return volume.promise;},reportKaminosVolumeRouteInitFailure(){},
 fetch:async()=>{events.push(['fetch']);return {ok:!failed,json:async()=>({version:8})};},
 planSceneRestore:()=>({composition}),sceneDocument:{holdRestore(){events.push(['hold']);},state:()=>({blocked:false})},
 File:class{},loadSceneFile:async()=>events.push(['apply']),setInfo(){},setActiveTab(){},document:{getElementById:()=>controls,body:{classList:{add(){}}}}
 };
 const handler=html.slice(html.indexOf('function reportKaminosVolumeRouteInitFailure('),html.indexOf('// The fluid boots once per page'));
 vm.runInNewContext(handler+'\n'+code,c);c.result.catch(()=>{});
 return {c,events,environment,volume,controls};
}
test('recipe recovery navigates before environment or fire preparation and never boots discarded fire',async()=>{
 const f=fixture();await flush();
 assert.equal(f.events.filter(e=>e[0]==='redirect').length,1,'saved recipe must redirect while expensive initialization is still pending');
 assert.equal(f.events.some(e=>e[0]==='boot'),false,'discarded page must never start fire');
 await f.c.result;assert.equal(f.events.some(e=>e[0]==='apply'),false);
});
test('matching recipe boots once and applies only after environment and fire finish',async()=>{
 const f=fixture({matching:true});await flush();assert.equal(f.events.filter(e=>e[0]==='boot').length,1);
 assert.equal(f.events.some(e=>e[0]==='apply'),false);f.volume.resolve();await flush();assert.equal(f.events.some(e=>e[0]==='apply'),false);
 f.environment.resolve();await f.c.result;assert.equal(f.events.filter(e=>e[0]==='apply').length,1);assert.equal(f.events.some(e=>e[0]==='redirect'),false);
});
test('unavailable saved document fails without initializing fire',async()=>{
 const f=fixture({failed:true});await flush();assert.equal(f.events.some(e=>e[0]==='boot'),false);await assert.rejects(f.c.result,/Scene unavailable/);
});
test('ordinary startup does not fetch a saved document or initialize fire',async()=>{
 const f=fixture({ordinary:true});f.environment.resolve();await f.c.result;assert.deepEqual(f.events,[]);
});

test('scene admission rejection preserves preset controls; actual fire startup rejection faults them',async()=>{
 const missing=fixture({matching:true,failed:true});await assert.rejects(missing.c.result,/Scene unavailable/);await flush();
 assert.equal(missing.controls.disabled,false,'missing scene must not disable an unrelated preset');assert.equal(missing.events.some(e=>e[0]==='preset-failure'),false);
 const broken=fixture({matching:true});broken.environment.resolve();await flush();broken.volume.reject(Error('device initialization failed'));
 await assert.rejects(broken.c.result,/device initialization failed/);await flush();assert.equal(broken.controls.disabled,true);
 assert.equal(broken.events.filter(e=>e[0]==='preset-failure').length,1);
});
