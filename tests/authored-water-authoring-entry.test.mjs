// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeLocalLiquidSetup,defaultLocalLiquidSetup} from '../local-liquid-setup.mjs';
import {resolveAuthoredWaterSampling} from '../authored-water-drop.mjs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function actual(name){const a=source.indexOf('async function '+name+'(');assert.ok(a>=0);const b=source.indexOf('\n}',a);return source.slice(a,b+2);}
test('ordinary Add uses the same finite default as the authored water operation',async()=>{
 let finite=0,legacy=0;
 const c={sceneObjects:[],LOCAL_LIQUID_EMITTER_CAPACITY:5,LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',LOCAL_LIQUID_EMITTER_SCHEMA:'schema',localLiquidSetup:null,
  assertSceneConstructionAvailable(){},defaultLocalLiquidSetup:()=>({}),makeSceneObjectId:()=> 'source',createLocalLiquidEmitterSceneRecord:x=>x,THREE:{},
  createLocalLiquidEmitterObject(){legacy++;return {object:{}};},scene:{add(){}},registerSceneObject(){},recordSceneObjectInsertion:async()=>true,mountLocalLiquidHost:async()=>true,
  setInfo(){},window:{_kaminosDirty(){}},addAuthoredWaterDrop:async()=>{finite++;return 'source';}};
 sceneContext(c);vm.runInContext(actual('addLocalLiquidEmitter'),c);await c.addLocalLiquidEmitter();
 assert.equal(finite,1,'Normal Add must reach finite default');assert.equal(legacy,0,'Normal Add must not create a legacy nozzle');
});
test('restored finite setup remains an editable preview until explicit release',async()=>{
 let allocations=0,preview=false;
 const c={localLiquidSetup:defaultLocalLiquidSetup(),normalizeLocalLiquidSetup,resolveAuthoredWaterSampling,refreshAuthoredWaterSamplingPreviews(){},localLiquidHost:null,localLiquidPaused:false,localLiquidFailure:null,
  localLiquidEmitterRecords:()=>[{transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.5,samplesPerUnit:32}}}],setAuthoredWaterPreviewVisible:v=>preview=v,
  localLiquidHostMount:{mount:async()=>{allocations++;return true;}},refreshLocalLiquidPerformance(){},authoredWaterControls:null,structuredClone,setInfo(){},window:{_kaminosDirty(){}}};
 sceneContext(c);vm.runInContext(actual('mountLocalLiquidHost'),c);await c.mountLocalLiquidHost();
 assert.equal(allocations,0,'Restoring initial finite water must not freeze a GPU population ahead of placement');assert.equal(preview,true);assert.equal(c.localLiquidPaused,true);
});
test('finite simulation selection does not expose unrelated legacy basin budget controls',()=>{
 const water={hidden:true},a=source.indexOf('function updateAuthoringPropertySelection()'),b=source.indexOf('\n}',a);
 const c={document:{getElementById:id=>id==='local-liquid-performance'?water:null,querySelectorAll:()=>[]},activeSceneFieldId:'water-field',activeSceneObjectId:null,FLAME_EMITTER_ID:'flame',authoredFlamePresent:false,
  flameInspector:null,syncBurnerInspector(){},syncSceneDataInspector(){},localLiquidEmitterRecords:()=>[{localLiquidEmitter:{mode:'finite_drop'}}]};sceneContext(c);vm.runInContext(source.slice(a,b+2),c);c.updateAuthoringPropertySelection();
 assert.equal(water.hidden,true,'Finite water field must show its actual settings rather than a legacy basin budget');
});

test('legacy fluid diagnostics appear only for the standalone bench route',()=>{
 const nodes=new Map(['sam-image-viewport','finger-fluid-bench-operator-panel','finger-fluid-bench-diagnostics'].map(id=>[id,{hidden:false}]));
 const c={authoringWorkspace:null,sharedWorkbench:null,document:{body:{classList:{toggle(){}}},getElementById:id=>nodes.get(id),querySelectorAll:()=>[]},samImageTools:null,window:{location:{search:''}},URLSearchParams,startFingerFluidBench(){},stopFingerFluidBench(){}};
 const a=source.indexOf('function setActiveTab('),b=source.indexOf('\n}',a);sceneContext(c);vm.runInContext(source.slice(a,b+2),c);
 c.setActiveTab('finger-fluid-bench');assert.equal(nodes.get('finger-fluid-bench-diagnostics').hidden,true,'Ordinary authored water must not report a separate idle/loading bench');
 c.window.location.search='?kaminos_finger_fluid_bench=1';c.setActiveTab('finger-fluid-bench');assert.equal(nodes.get('finger-fluid-bench-diagnostics').hidden,false);
});
