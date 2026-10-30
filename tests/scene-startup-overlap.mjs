// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('  const startupSceneHash ='),end=source.indexOf('  startupSceneRestore.catch',start);
assert.ok(start>=0&&end>start);
const code=source.slice(start,end)+';globalThis.result=startupSceneRestore;';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('saved document fetch overlaps environment/fire preparation; application waits for both',async()=>{
 const environment=deferred(),volume=deferred();const events=[];
 const c={URLSearchParams,location:{hash:'#scene=chosen.kaminos.json',search:''},environmentLoaded:environment.promise,volumeLoaded:volume.promise,
  fetch:async url=>{events.push(['fetch',url]);return {ok:true,json:async()=>({version:8,objects:[]})};},
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
 const c={URLSearchParams,location:{hash:''},environmentLoaded:Promise.resolve(),volumeLoaded:Promise.resolve(),fetch:()=>assert.fail('ordinary startup has no scene payload')};
 vm.runInNewContext(code,c);await c.result;
});
