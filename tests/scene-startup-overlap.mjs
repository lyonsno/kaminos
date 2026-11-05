// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fireAtBoot} from '../fire-boot.mjs';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('  const startupSceneRedirect ='),admissionEnd=source.indexOf('let startupSceneAdmitted',start);
const volumeStart=source.indexOf('  const volumeLoaded =',admissionEnd),end=source.indexOf('  startupSceneRestore.catch',volumeStart);
assert.ok(start>=0&&admissionEnd>start&&volumeStart>admissionEnd&&end>volumeStart);
const code=source.slice(start,admissionEnd)+source.slice(volumeStart,end)+';globalThis.result=startupSceneRestore;';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('saved document acquisition precedes environment preparation; application waits for both owners',async()=>{
 const environment=deferred(),volume=deferred();const events=[];
 const c={URLSearchParams,location:{hash:'#scene=chosen.kaminos.json',search:''},environmentLoaded:environment.promise,window:{},ownerVolumeReady:null,fireAtBoot,initKaminosVolumeRoute:()=>volume.promise,reportKaminosVolumeRouteInitFailure(){},
  fetch:async url=>{events.push(['fetch',url]);return {ok:true,json:async()=>({version:8,objects:[]}),text:async()=>'{"version":8,"objects":[]}'};},
  sceneDocument:{holdRestore:()=>events.push(['hold']),state:()=>({blocked:false})},
  planSceneRestore:()=>({composition:null}),File:class {constructor(parts,name){this.name=name;}},
  loadSceneFile:async file=>events.push(['apply',file.name]),
 };
 vm.runInNewContext(code,c);await Promise.resolve();
 assert.equal(events[0]?.[0],'fetch','document acquisition must not wait for renderer/environment preparation');
 assert.equal(events.some(e=>e[0]==='apply'),false);environment.resolve();await Promise.resolve();
 assert.equal(events.some(e=>e[0]==='apply'),false);volume.resolve();await c.result;
 assert.deepEqual(events.map(e=>e[0]),['fetch','hold','apply']);
});
test('ordinary startup requests no saved document',async()=>{
 const c={URLSearchParams,location:{hash:'',search:''},environmentLoaded:Promise.resolve(),window:{},ownerVolumeReady:null,fireAtBoot,initKaminosVolumeRoute:()=>assert.fail('ordinary startup has no fire'),reportKaminosVolumeRouteInitFailure(){},fetch:()=>assert.fail('ordinary startup has no scene payload')};
 vm.runInNewContext(code,c);await c.result;
});

test('saved startup restores the original downloaded text without creating a serialized File',async()=>{
 const original=' {"version":8,"objects":[]} \n';let restored;
 const c={URLSearchParams,location:{hash:'#scene=chosen.kaminos.json',search:''},environmentLoaded:Promise.resolve(),window:{},ownerVolumeReady:null,fireAtBoot,initKaminosVolumeRoute:()=>Promise.resolve(),reportKaminosVolumeRouteInitFailure(){},
 fetch:async()=>({ok:true,json:async()=>JSON.parse(original),text:async()=>original}),sceneDocument:{holdRestore(){},state:()=>({blocked:false})},planSceneRestore:()=>({composition:null}),File:class{constructor(){throw Error('unnecessary full-document File serialization');}},loadSceneFile:async file=>{restored=await file.text();}};
 vm.runInNewContext(code,c);await c.result;assert.equal(restored,original);
});
