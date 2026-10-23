// kaminos-test: node
import assert from 'node:assert/strict';
import {mountAuthoredWaterControls} from '../authored-water-controls.mjs';
function fixture({sourceRoot=null,simulationRoot=null}={}){
 const nodes=new Map(),numbers=[],boundInputs=[];
 const input=selector=>{if(!nodes.has(selector)){const node={value:'',checked:false,dataset:{},classList:{add(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}};nodes.set(selector,node);}return nodes.get(selector);};
 for(const name of ['width','samples','rate','radius','strength','passes','target'])numbers.push(input('[data-'+name+']'));
 const section={querySelector:input,querySelectorAll(selector){if(selector==='label')return [];if(selector==='input[type=number]')return [...numbers,...boundInputs];if(selector==='[data-bound]')return boundInputs;const kind=selector.match(/data-bound=(min|max)/)?.[1];return boundInputs.filter(n=>n.dataset.bound===kind);},remove(){}};
 input('[data-bounds]').append=row=>boundInputs.push(...row.children);
 input('[data-simulation]').querySelectorAll=section.querySelectorAll.bind(section);
 const document={createElement(tag){if(tag==='section')return section;return {type:'',dataset:{},children:[],classList:{add(){}},listeners:{},setAttribute(){},addEventListener(k,fn){this.listeners[k]=fn;},append(child){this.children.push(child);}};}};
 const source=(id,width)=>({id,label:id,settings:{mode:'finite_drop',rate:1200,baseRadius:.08,strength:1.15,drop:{width,samplesPerUnit:32,container:{min:[-2,-1,-2],max:[2,3,2]}}}});
 let selected=source('A',.5),runtime=null,hold=null;const edits=[];
 const api={read:()=>({selected,runtime}),edit:(id,settings)=>{edits.push({id,settings});return hold??Promise.resolve();},add(){},release(){},pause(){}};
 const controls=mountAuthoredWaterControls({schedule:()=>1,cancel(){},document,root:{prepend(){}},sourceRoot,simulationRoot,controls:{installNumberDrag:()=>({stop(){}})},api});
 return {controls,input,edits,api,select(id,width){selected=source(id,width);controls.refresh();},draftWidth(width){input('[data-width]').value=width;input('[data-width]').listeners.input();},setRuntime(value){runtime=value;},hold(p){hold=p;}};
}
{
 const f=fixture();f.draftWidth(.75);f.select('B',1);assert.equal(Number(f.input('[data-width]').value),1,'Source B must not inherit source A pending amount');f.draftWidth(1.25);await f.controls.flush();assert.equal(f.edits[0].id,'B');assert.equal(f.edits[0].settings.drop.width,1.25);
}
{
 const f=fixture();let complete;f.hold(new Promise(r=>complete=r));f.draftWidth(.75);const pending=f.controls.flush();f.select('B',1);f.draftWidth(1.25);complete();await pending;assert.equal(Number(f.input('[data-width]').value),1.25,'Old action completion must preserve a newer source draft');
 f.setRuntime({paused:true,step:12,particleCount:4096});f.controls.refreshStatus();assert.match(f.input('[data-state]').textContent,/tick 12/);assert.equal(Number(f.input('[data-width]').value),1.25,'Clock refresh must not rewrite draft');
}
console.log('Source drafts retain identity and current playback status does not overwrite pending edits');
const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
const application=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const frameStart=application.indexOf('  function renderSceneFrame()'),armStart=application.indexOf('    if (localLiquidHost) {',frameStart),armEnd=application.indexOf('    }));',armStart)>=0?application.indexOf('    }));',armStart):application.indexOf('    sceneFrameCount++',armStart),arm=application.slice(armStart,armEnd);
for(const mode of ['continuous','finite_drop','failure']){
 const f=fixture();f.draftWidth(.75);let step=0,present=true,footer=null;
 const host={render(){if(mode==='failure')throw Error('frame rejected');step=12;},state:()=>mode==='continuous'?{solver:{stepCount:step,simulatedTimeSeconds:step/240}}:{mode,clock:{paused:false,step,timeSeconds:step/240}},dispose(){present=false;}};
 // Keep the controls' read layer bound to the same current runtime.
 f.setRuntime({paused:false,step:0,particleCount:4096});
 const c={isSceneItemVisible:()=>true,outputCaptureExtent:null,recordingFrameSink:null,matchedCameraEffective:false,ordinarySceneTransportFrame:null,applySceneEmissiveCamera(){},outlinedSceneOutput:{},outlinedCameraOutput:{},sceneEmissiveCamera:null,document:{getElementById:()=>({checked:false})},localLiquidHost:host,localLiquidFailure:null,console:{error(){}},String,authoredWaterControls:{refreshStatus(){f.setRuntime(present?{paused:false,step,particleCount:4096}:null);f.controls.refreshStatus();}},sharedWorkbench:{update(value){footer=value;}},refreshLocalLiquidPerformance(){},renderPipeline:{render(){}},setInfo(){}};
 vm.createContext(c);vm.runInContext(arm,c);
 if(mode==='failure'){assert.equal(footer?.status,'Stopped','Footer must retire failed runtime state');assert.equal(c.localLiquidHost,null);assert.equal(f.input('[data-pause]').textContent,'Play','Host loss offers a fresh start from retained sources');assert.doesNotMatch(f.input('[data-state]').textContent,/Playing/);}
 else {assert.match(f.input('[data-state]').textContent,/tick 12/,'Both supported source modes publish the effective clock');assert.match(footer?.clock??'',/tick 12/,'Footer agrees for both supported water modes');}
 assert.equal(Number(f.input('[data-width]').value),.75,'Runtime updates preserve drafts');
}
{
 const a=application.indexOf('window.kaminosPauseLocalLiquid = paused => {'),b=application.indexOf('\n};',a),f=fixture();let paused=false;f.setRuntime({paused:false,step:12,particleCount:4096});
 const c={Boolean,window:{_kaminosDirty(){}},localLiquidPaused:false,localLiquidHost:{setPaused(v){paused=v;}},refreshLocalLiquidPerformance(){},authoredWaterControls:{refreshStatus(){f.setRuntime({paused,step:12,particleCount:4096});f.controls.refreshStatus();}}};vm.createContext(c);vm.runInContext(application.slice(a,b+3),c);c.window.kaminosPauseLocalLiquid(true);assert.match(f.input('[data-state]').textContent,/Paused · tick 12/);
}

// Cross the actual finite host/facade/application/control boundary: accessor
// forwarding cannot be established with a substitute application host.
{
 const {createFiniteFluidHost}=await import('../finite-fluid-host.mjs');
 const finite=await createFiniteFluidHost({setup:{dt:1/240,support:{kind:'invisible_box'},solver:{rendererMode:'screen_space_refraction',particleCount:13824,diagnosticPopulation:{},diagnosticBox:{}}},device:{queue:{onSubmittedWorkDone:async()=>{}}},
  createSolver:async()=>({available:true,step(){},getDebugState:()=>({particleCount:13824}),destroy(){}}),
  createPresentation:()=>({state:()=>({}),render(){},dispose(){}})});
 const source=readFileSync(new URL('../authored-water-host.mjs',import.meta.url),'utf8');
 const facadeBody=source.slice(source.indexOf(' return {...finite,'),source.lastIndexOf('\n}'));
 const facade=new Function('finite','initial','records','pendingSetup','options',facadeBody)(finite,{sourceIds:['A']},[],{}, {setup:{}});
 const f=fixture(),row={id:'A',localLiquidEmitter:{mode:'finite_drop',drop:{width:.5,samplesPerUnit:32,container:{min:[-2,-1,-2],max:[2,3,2]}}}};
 const c={authoredWaterSimulationState:()=>({present:true}),localLiquidEmitterRecords:()=>[{id:'A',localLiquidEmitter:{mode:'finite_drop'}}],editAuthoredWaterSimulation(){},structuredClone,Boolean,window:{_kaminosDirty(){}},localLiquidHost:facade,localLiquidFailure:null,localLiquidPaused:true,
  authoredWaterDraftPreview:null,localLiquidSetup:null,sceneObjectTransformState:()=>({position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]}),describeAuthoredWaterDrop:()=>({}),resolveAuthoredWaterSampling:()=>({}),selectedWaterSource:()=>row,sceneObjectDisplayLabel:()=> 'A',refreshLocalLiquidPerformance(){},authoredWaterControls:f.controls};
 vm.createContext(c);
 const reader=application.slice(application.indexOf('function authoredWaterState(){'),application.indexOf('\nconst waterSettingTargets='));
 const pauseStart=application.indexOf('window.kaminosPauseLocalLiquid = paused => {'),pauseEnd=application.indexOf('\n};',pauseStart);
 const apiStart=application.indexOf('window.kaminosWaterSources={'),apiEnd=application.indexOf('\n',apiStart);
 Object.assign(c,{fitAuthoredWaterBounds(){},addAuthoredWaterDrop(){},applyAuthoredWaterSettings(){},releaseAuthoredWater(){},resetAuthoredWater(){},matchAuthoredWaterSetup(){},previewAuthoredWaterSetup(){}});
 vm.runInContext(reader+application.slice(pauseStart,pauseEnd+3)+application.slice(apiStart,apiEnd),c);
 f.api.read=()=>c.window.kaminosWaterSources.read();f.api.pause=()=>c.window.kaminosWaterSources.pause();f.controls.refresh();
 const check=(paused,step)=>{
  f.controls.refreshStatus();assert.equal(facade.paused,paused,'Authored facade must forward effective playback state');
  assert.equal(c.window.kaminosWaterSources.read().runtime.paused,paused);
  assert.match(f.input('[data-state]').textContent,new RegExp(`${paused?'Paused':'Playing'} · tick ${step}`));
  assert.equal(f.input('[data-pause]').textContent,paused?'Play':'Pause');
  const drawContext={...c,isSceneItemVisible:()=>true,outputCaptureExtent:null,recordingFrameSink:null,ordinarySceneTransportFrame:null,console,sharedWorkbench:{update(value){drawContext.footer=value;}},renderPipeline:{render(){}},setInfo(){}};
  vm.createContext(drawContext);vm.runInContext(arm,drawContext);
  assert.equal(drawContext.footer.status,paused?'Paused':'Playing','Footer and panel agree on playback');
 };
 facade.setPaused(false);check(false,0);f.draftWidth(.75);
 await f.input('[data-pause]').onclick();check(true,0);assert.equal(Number(f.input('[data-width]').value),.75,'Playback toggle preserves pending amount');
 await f.input('[data-pause]').onclick();check(false,0);assert.equal(Number(f.input('[data-width]').value),.75);
 await c.window.kaminosWaterSources.advanceTo(12);check(true,12);assert.equal(Number(f.input('[data-width]').value),.75);
 await facade.restart();check(true,0);assert.equal(Number(f.input('[data-width]').value),.75);
 facade.dispose();
}
console.log('Real finite facade, public source state, controls and footer agree through play/pause/advance/reset');

{
 const children=[],f=fixture({sourceRoot:{append(node){children.push(node);}}});
 assert.ok(children.includes(f.input('[data-selected]')),'The existing inspector slot must own the one live source properties node');
}

for(const applied of ['finite_drop','continuous'])for(const action of ['pause','release']){
 const f=fixture(),pending=applied==='finite_drop'?'continuous':'finite_drop';if(action==='pause')f.setRuntime({paused:false,step:12,particleCount:4096});
 const original=f.api.read;f.api.read=()=>{const s=original();return {...s,selected:{...s.selected,settings:{...s.selected.settings,mode:applied}}};};f.controls.refresh();
 f.input('[data-mode]').value=pending;f.input('[data-mode]').onchange();f.draftWidth(.75);
 const check=()=>{assert.equal(f.input('[data-mode]').value,pending);assert.equal(f.input('[data-drop]').hidden,pending!=='finite_drop','Visible fields must follow the retained pending mode');assert.equal(f.input('[data-flow]').hidden,pending!=='continuous');assert.equal(Number(f.input('[data-width]').value),.75);};
 check();await f.input('[data-'+action+']').onclick();if(action==='pause')check();else {assert.equal(f.edits.at(-1).settings.mode,pending);assert.equal(f.edits.at(-1).settings.drop.width,.75);}
}

{
 const children=[],f=fixture({simulationRoot:{append(node){children.push(node);}}});
 assert.ok(children.includes(f.input('[data-simulation]')),'Selected simulation properties own the live editable settings, not just a link to the left tool');
 let passes=2;const read=f.api.read;f.api.read=()=>({...read(),simulation:{present:true,selected:true,settings:{densityIterations:passes}}});f.api.editSimulation=patch=>{passes=patch.densityIterations;};f.controls.refresh();
 assert.equal(Number(f.input('[data-passes]').value),2);f.input('[data-passes]').value=5;f.input('[data-passes]').listeners.input();await f.controls.flush();assert.equal(passes,5);f.controls.refresh();assert.equal(Number(f.input('[data-passes]').value),5);
}

{
 const f=fixture();f.hold(Promise.reject(Error('Drop world bounds must have positive extents')));
 f.draftWidth(.75);await f.controls.flush();assert.match(f.input('[data-source-error]').textContent??'',/positive extents/,'Rejected source Apply must explain failure beside source properties when Fluid is hidden');
 f.hold(null);await f.controls.flush();assert.equal(f.input('[data-source-error]').textContent,'','A valid source Apply clears source feedback');
 f.api.release=()=>{throw Error('Release failed');};await f.input('[data-release]').onclick();assert.equal(f.input('[data-run-error]').textContent,'Release failed','Run rejection stays with left playback actions');
}

{
 const f=fixture(),read=f.api.read;let matched=0,compatible=false;
 f.api.read=()=>({...read(),sources:[{id:'A'},{id:'B'}],simulation:{present:true,settings:{densityIterations:2},compatibility:{compatible,sourceCount:2,message:'B: particle spacing differs',match:{referenceId:'A',referenceLabel:'A',spacing:.05,containerEnabled:true,particleCount:3925,changes:compatible?[]:[{id:'B',label:'B',previousWorldWidth:.63,worldWidth:.65,previousParticleCount:250047,particleCount:2197}]}}}});
 f.api.match=id=>{assert.equal(id,'A');matched++;compatible=true;};f.controls.refresh();
 assert.equal(f.input('[data-pause]').disabled,true,'An incompatible initial setup cannot offer a false Play');assert.equal(f.input('[data-release]').disabled,true);assert.match(f.input('[data-compatibility-status]').textContent,/B.*spacing/);assert.match(f.input('[data-match-plan]').textContent,/0.63000 → 0.65000/);assert.equal(matched,0,'Showing the repair cannot change source amounts');
 await f.input('[data-match]').onclick();assert.equal(matched,1);assert.equal(f.input('[data-pause]').disabled,false);assert.equal(f.input('[data-release]').disabled,false);assert.equal(f.input('[data-match]').hidden,true);
}

{
 const f=fixture(),read=f.api.read;let inside=false;
 f.api.read=()=>({...read(),simulation:{present:true,compatibility:{compatible:inside,sourceCount:1,message:inside?'':'A: initial particles must fit the shared world bounds. Move the drop or enlarge the bounds.',matchError:'Move the drop or enlarge the bounds.'}}});f.controls.refresh();
 assert.equal(f.input('[data-compatibility]').hidden,false,'SWCOMP-1: single-drop placement diagnosis must remain visible');assert.match(f.input('[data-compatibility-status]').textContent,/A:.*Move the drop/);assert.equal(f.input('[data-pause]').disabled,true);assert.equal(f.input('[data-match]').hidden,true);
 inside=true;f.controls.refresh();assert.equal(f.input('[data-compatibility]').hidden,true);assert.equal(f.input('[data-pause]').disabled,false);
}
