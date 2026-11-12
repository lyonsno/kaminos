// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const path=new URL('../volume-runtime-control-values.mjs',import.meta.url);
const api=await import(path).catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND'||e.url!==path.href)throw e;return {};});
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/volume-runtime-controls/page-b99.json',import.meta.url),'utf8'));
const definitions=JSON.parse((await import('node:child_process')).execFileSync('python3',[new URL('../tools/scene-worker-control-definitions.py',import.meta.url).pathname,'--page',new URL('../index.html',import.meta.url).pathname])).controls;
const defaults=Object.fromEntries(Object.entries(definitions).map(([id,d])=>[id,{value:d.value,checked:d.checked,dataset:{}}]));
const retired=['boundarySplatMode','boundarySplatFeatureCapture','flowKernelDescriptorCapture','boundarySplatInstanceConsumer','boundarySplatInstances','boundarySplatRadius','boundarySplatSharpness','volumeResidualMode','volumeResidualModelUrl','volumeResidualStrength','volumeResidualFeatureDebug'];
for(const f of fixtures){
 f.controls={...structuredClone(defaults),...f.controls};
 for(const key of retired)delete f.expected[key];
 Object.assign(f.expected,{occupancyThreshold:0,historyInfluence:1,historyWindow:1,reconstructionFresh:true,integralReconstruction:'off',reconstructionSpatial:.6,reconstructionRadius:1,reconstructionWindow:8,reconstructionResponse:1,reconstructionImageEdge:1,reconstructionEdges:'samples',reconstructionEdge:2,worldSmokeJoin:'prescribed-flow',swirlJostle:0,fineBreakupLocalization:0,microdetail:0,fireLicks:0,adaptiveRays:0,fireScale:1,reactionLaw:'reactant-v0',appearanceModel:'shred-only'});
 f.expected.runtimeQualityReceipt.knobs.adaptiveRays=0;
}
for(const fixture of fixtures)test(`plain saved descriptors preserve surviving b99 coefficients and current main retirements at ${fixture.quality} quality`,()=>{
 assert.equal(typeof api.readVolumeRuntimeControlValues,'function','actual page mapper must work without a DOM');
 const controls=structuredClone(fixture.controls),route=structuredClone(fixture.route);
 const result=api.readVolumeRuntimeControlValues({readControl:id=>{
  const value=controls[id];assert.ok(value,`unexpected control ${id}`);
  return {...value,requestedValue:id==='volume-scene'?value.dataset?.volumeSceneRequest:value.dataset?.volumeRetiredPatternRequest};
 },quality:fixture.quality,params:new URLSearchParams(fixture.params),lightFieldParams:new URLSearchParams(fixture.lightFieldParams),route,adaptiveMaterial:null});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),fixture.expected);
 assert.deepEqual(controls,fixture.controls);assert.deepEqual(route,fixture.route);
 assert.equal(result.volumeScene,'flame');assert.equal(result.volumeSceneRequested,'bonfire_plume');assert.equal(result.emitterAperturePattern,'spiral');
 assert.equal(result.pressureIterations,3);assert.equal(result.worldSmokeMaterial,64);assert.equal(result.worldSmokeFlow,32);
 assert.equal(result.physicalThermalStrength,.7);assert.equal(result.waveletStrength,.7);assert.equal(result.legacyPyroBackedOff,true);
});

test('the actual page wrapper consumes the shared mapper and preserves pending grid dimensions',async()=>{
 const vm=await import('node:vm');const page=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=page.indexOf('function readVolumeControls('),end=page.indexOf('\n}',start)+2;
 const f=fixtures[0],document={getElementById:id=>f.controls[id]},context={routedVolumePressureIterations:undefined,...f.route,document,window:{location:{search:f.params}},URLSearchParams,
  volumeAperturePatternValue:control=>api.volumeAperturePatternValue({value:control.value,requestedValue:control.dataset.volumeRetiredPatternRequest}),viewportDisplay:{quality:'full'},readVolumeRuntimeControlValues:api.readVolumeRuntimeControlValues,
  adaptiveMaterialRuntimeControls:()=>null,fireLightFieldRouteParams:()=>new URLSearchParams(f.lightFieldParams),volumeRebuildControlValue:()=>1.25};
 vm.createContext(context);vm.runInContext(page.slice(start,end),context);
 const actual=context.readVolumeControls();assert.equal(actual.gridHeightRatio,1.25);
 const expected={...f.expected,gridHeightRatio:1.25};assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected);
});

test('actual adaptive coefficients pass through; live pressure and route quality retain existing policy',()=>{
 const f=fixtures[0],adaptiveMaterial={budget:.75,weights:{reaction:1}},controls={...f.controls,'volume-pressure-mode':{value:'routed-global'}};
 const result=api.readVolumeRuntimeControlValues({readControl:id=>controls[id],route:{...f.route,routedVolumePressureIterations:12,routedVolumeRuntimeQuality:'auto',routedVolumeGpuPressure:.5},adaptiveMaterial});
 assert.equal(result.pressureIterations,12);assert.equal(result.runtimeQualityEffective,'live_low');assert.equal(result.raySteps,96);assert.equal(result.renderScale,.75);assert.deepEqual(result.adaptiveMaterial,adaptiveMaterial);
 assert.deepEqual(adaptiveMaterial,{budget:.75,weights:{reaction:1}});
});

test('saved scene and basin descriptors use the same actual mapper without control elements',async()=>{
 assert.equal(typeof api.readAuthoredVolumeRuntimeControls,'function','saved settings need the actual shared value consumer');
 const {ADAPTIVE_MATERIAL_FIELDS}=await import('../volume-adaptive-material-controls.mjs');
 const schema=JSON.parse(fs.readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url),'utf8'));
 const types=new Map([...schema.controls,...schema.rendererControls].map(entry=>[entry.key,entry.type]));
 const f=fixtures[0],domControls={},rendererControls={};
 for(const [id,control]of Object.entries(f.controls)){
  const type=types.get(id)??'number',value=type==='checkbox'?control.checked:control.value;
  (schema.rendererControls.some(entry=>entry.key===id)?rendererControls:domControls)[id]={type,value};
 }
 for(const field of ADAPTIVE_MATERIAL_FIELDS)domControls[field.id]={type:field.type,value:field.value};
 domControls['volume-emitter-aperture-pattern'].value='spiral';
 const settings={domControls,rendererControls,volumeSceneRequested:'bonfire_plume'},before=structuredClone(settings);
 const actual=api.readAuthoredVolumeRuntimeControls(settings,{route:f.route,quality:f.quality,params:new URLSearchParams(f.params),lightFieldParams:new URLSearchParams(f.lightFieldParams)});
 assert.deepEqual(JSON.parse(JSON.stringify(actual)),f.expected);assert.deepEqual(settings,before);
 delete settings.domControls['volume-resolution'];assert.throws(()=>api.readAuthoredVolumeRuntimeControls(settings,{route:f.route}),/Missing.*volume-resolution/);
});

test('current scene controls retain nested join and temporal reconstruction without retired renderer output',()=>{
 const f=fixtures[0],extra={
  'volume-world-smoke-join':{value:'flux'},'volume-history-influence':{value:'.7'},'volume-history-window':{value:'5'},
  'volume-reconstruction-fresh':{checked:true},'volume-integral-reconstruction':{value:'off'},
  'volume-reconstruction-spatial':{value:'.4'},'volume-reconstruction-radius':{value:'2'},'volume-reconstruction-window':{value:'8'},
  'volume-reconstruction-response':{value:'.6'},'volume-reconstruction-image-edge':{value:'.2'},'volume-reconstruction-edges':{value:'image'},'volume-reconstruction-edge':{value:'.3'},
 };
 const result=api.readVolumeRuntimeControlValues({readControl:id=>extra[id]??f.controls[id],route:f.route});
 assert.equal(result.worldSmokeJoin,'flux');assert.equal(result.historyInfluence,.7);assert.equal(result.historyWindow,5);
 assert.equal(result.reconstructionFresh,true);assert.equal(result.reconstructionRadius,2);
 assert.equal(Object.hasOwn(result,'boundarySplatInstanceConsumer'),false,'retired splat consumer is outside the runtime control result');
});
