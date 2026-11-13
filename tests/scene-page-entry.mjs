// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
const url=new URL('../scene-page-entry.mjs',import.meta.url);const api=await import(url).catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND'||e.url!==url.href)throw e;return {};});
const start=options=>{assert.equal(typeof api.startScenePage,'function','page must choose its worker entry before activating the legacy module');return api.startScenePage(options);};
test('worker route imports only its page adapter and never reads or activates the legacy module',async()=>{
 let loads=0,boots=0;const document={getElementById(){throw Error('legacy data block was read');},createElement(){throw Error('legacy script was activated');}};
 const result=await start({document,location:{href:'http://localhost/?scene_worker=1#scene=authored.kaminos.json'},loadWorker:async()=>{loads++;return{startSceneWorkerPage:async()=>{boots++;return 'actual-worker-owner';}};}});
 assert.equal(loads,1);assert.equal(boots,1);assert.equal(result,'actual-worker-owner');
});
test('worker startup failure stays failed and cannot start the legacy GPU owner',async()=>{
 let mutations=0;const document={getElementById(){mutations++;throw Error('legacy');},createElement(){mutations++;throw Error('legacy');}};
 await assert.rejects(start({document,location:{href:'http://localhost/?scene_worker=1'},loadWorker:async()=>{throw Error('worker admission failed');}}),/worker admission failed/);assert.equal(mutations,0);
});
test('ordinary route activates one fresh module from the canonical inert legacy source',async()=>{
 const source='import "./actual-module.mjs";\nawait initializeOrdinaryScene();',created=[],mounted=[];
 const document={getElementById(id){assert.equal(id,'kaminos-legacy-page-module');return{content:{querySelector(selector){assert.equal(selector,'script[type="module"]');return{textContent:source};}}};},createElement(tag){assert.equal(tag,'script');const value={};created.push(value);return value;},body:{appendChild(value){mounted.push(value);}}};
 const result=await start({document,location:{href:'http://localhost/?scene_worker=0'},loadWorker(){throw Error('worker entry used for ordinary route');}});
 assert.equal(created.length,1);assert.equal(mounted[0],created[0]);assert.equal(created[0].type,'module');assert.equal(created[0].textContent,source);assert.equal(result.route,'legacy');
});
