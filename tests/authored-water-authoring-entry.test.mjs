// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function actual(name){const a=source.indexOf('async function '+name+'(');assert.ok(a>=0);const b=source.indexOf('\n}',a);return source.slice(a,b+2);}
test('ordinary Add uses the same finite default as the authored water operation',async()=>{
 let finite=0,legacy=0;
 const c={sceneObjects:[],LOCAL_LIQUID_EMITTER_CAPACITY:5,LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',LOCAL_LIQUID_EMITTER_SCHEMA:'schema',localLiquidSetup:null,
  assertSceneConstructionAvailable(){},defaultLocalLiquidSetup:()=>({}),makeSceneObjectId:()=> 'source',createLocalLiquidEmitterSceneRecord:x=>x,THREE:{},
  createLocalLiquidEmitterObject(){legacy++;return {object:{}};},scene:{add(){}},registerSceneObject(){},recordSceneObjectInsertion:async()=>true,mountLocalLiquidHost:async()=>true,
  setInfo(){},window:{_kaminosDirty(){}},addAuthoredWaterDrop:async()=>{finite++;return 'source';}};
 vm.createContext(c);vm.runInContext(actual('addLocalLiquidEmitter'),c);await c.addLocalLiquidEmitter();
 assert.equal(finite,1,'Normal Add must reach finite default');assert.equal(legacy,0,'Normal Add must not create a legacy nozzle');
});
test('restored finite setup remains an editable preview until explicit release',async()=>{
 let allocations=0,preview=false;
 const c={localLiquidSetup:{},localLiquidHost:null,localLiquidPaused:false,localLiquidFailure:null,
  localLiquidEmitterRecords:()=>[{localLiquidEmitter:{mode:'finite_drop'}}],setAuthoredWaterPreviewVisible:v=>preview=v,
  localLiquidHostMount:{mount:async()=>{allocations++;return true;}},refreshLocalLiquidPerformance(){},authoredWaterControls:null,structuredClone,setInfo(){},window:{_kaminosDirty(){}}};
 vm.createContext(c);vm.runInContext(actual('mountLocalLiquidHost'),c);await c.mountLocalLiquidHost();
 assert.equal(allocations,0,'Restoring initial finite water must not freeze a GPU population ahead of placement');assert.equal(preview,true);assert.equal(c.localLiquidPaused,true);
});
test('finite simulation selection does not expose unrelated legacy basin budget controls',()=>{
 const water={hidden:true},a=source.indexOf('function updateAuthoringPropertySelection()'),b=source.indexOf('\n}',a);
 const c={document:{getElementById:id=>id==='local-liquid-performance'?water:null,querySelectorAll:()=>[]},activeSceneFieldId:'water-field',activeSceneObjectId:null,FLAME_EMITTER_ID:'flame',authoredFlamePresent:false,
  syncBurnerInspector(){},syncSceneDataInspector(){},localLiquidEmitterRecords:()=>[{localLiquidEmitter:{mode:'finite_drop'}}]};vm.createContext(c);vm.runInContext(source.slice(a,b+2),c);c.updateAuthoringPropertySelection();
 assert.equal(water.hidden,true,'Finite water field must show its actual settings rather than a legacy basin budget');
});
