// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function source(name){const a=html.indexOf(`function ${name}(`);assert.ok(a>=0,name);return html.slice(a,html.indexOf('\n}',a)+2);}
function page({mounted=false,initError=null,abortDuringInit=false}={}){
 const events=[],controller=new AbortController();
 const c={activeSceneComposition:mounted?{}:null,authoringBusy:false,FLAME_EMITTER_ID:'flame-emitter',COMPOSITION_SCHEMA:'composition',JSON,Error,
  assertSceneConstructionAvailable(){if(c.authoringBusy)throw Error('Scene is busy');},
  addBurnerObject(){events.push('existing-source');return 'flame-emitter';},
  async ensureKaminosVolumeRoute(){events.push('initialize');if(abortDuringInit)controller.abort();if(initError)throw initError;},
  firstFlameFieldState(){events.push('snapshot');return {composition:c.activeSceneComposition};},
  scenePlacementTools:{edits:{state:()=>({}),async applySettled(){events.push('create');assert.ok(events.includes('initialize'),'explicit Add initializes the lazy runtime before creating the field');c.activeSceneComposition={};}}},
  async loadAuthoredFlameBasin(){events.push('basin');return {source:{presetId:'basin'},domControls:Object.fromEntries(Object.entries({'volume-emitter-source-law':'immersed-source','volume-pressure-solver':'converged-open-top','volume-advection-scheme':'maccormack','volume-time-step':'uniform'}).map(([k,value])=>[k,{value}]))};},
  setActiveSceneObject(){events.push('select');},setInfo(){}
 };
 vm.createContext(c);vm.runInContext('async '+source('addFirstFlameField'),c);
 return {c,events,signal:controller.signal};
}

test('explicit Add Flame initializes an ordinary page before its settings snapshot and history write',async()=>{
 const {c,events}=page();assert.equal(await c.addFirstFlameField('basin'),'flame-emitter');
 assert.ok(events.indexOf('initialize')<events.indexOf('snapshot'));
 assert.ok(events.indexOf('initialize')<events.indexOf('create'));
 assert.equal(c.authoringBusy,false);
});
test('selecting an existing fire source or refusing a missing basin does not initialize another runtime',async()=>{
 const mounted=page({mounted:true});await mounted.c.addFirstFlameField();assert.deepEqual(mounted.events,['existing-source']);
 const empty=page();await assert.rejects(empty.c.addFirstFlameField(),/Choose a saved/);assert.deepEqual(empty.events,[]);
});
test('initialization failure leaves scene history and basin loading untouched',async()=>{
 const error=Error('GPU initialization refused'),{c,events}=page({initError:error});
 await assert.rejects(c.addFirstFlameField('basin'),e=>e===error);
 assert.deepEqual(events,['initialize']);assert.equal(c.activeSceneComposition,null);assert.equal(c.authoringBusy,false);
});
test('cancelling while initialization completes cannot insert a fire field',async()=>{
 const {c,events,signal}=page({abortDuringInit:true});await assert.rejects(c.addFirstFlameField('basin',{signal}),{name:'AbortError'});
 assert.deepEqual(events,['initialize']);assert.equal(c.activeSceneComposition,null);
});

test('startup and explicit creation share one initialization promise, including its failure',async()=>{
 for(const fail of [false,true]){
  let calls=0,release;const error=Error('initialization failed');
  const c={volumeRouteInitialization:null,initKaminosVolumeRoute(){calls++;return new Promise((resolve,reject)=>{release=()=>fail?reject(error):resolve('runtime');});}};
  vm.createContext(c);vm.runInContext(source('ensureKaminosVolumeRoute'),c);
  const a=c.ensureKaminosVolumeRoute(),b=c.ensureKaminosVolumeRoute();assert.equal(a,b);assert.equal(calls,1);
  const settlement=Promise.allSettled([a,b]);release();const rows=await settlement;
  assert.equal(rows[0].status,fail?'rejected':'fulfilled');assert.equal(rows[1].status,rows[0].status);
  if(fail)assert.equal(rows[0].reason,error);
  assert.equal(c.ensureKaminosVolumeRoute(),a,'partial initialization is never repeated');
 }
});
