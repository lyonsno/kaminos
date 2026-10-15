// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateStoneViewportHost} from '../structural-material-viewport-host.mjs';
import {createGpuExposedFaces} from '../structural-material-exposed-gpu.js';
import {buildFixedCellShell} from '../structural-material-bounded-fragments.mjs';

const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8');
const nativeHost=()=>{const device={},canvas={};return {device,adapter:{info:{isFallbackAdapter:false}},renderer:{backend:{device,isWebGPUBackend:true},domElement:canvas},scene:{isScene:true},camera:{isCamera:true},controls:{domElement:canvas}};};
test('explicit producer participation accepts native GPU access without a private frame subscription',()=>{
 const host=nativeHost();assert.equal(validateStoneViewportHost(host,{frameDriver:'manual'}),host);
 assert.throws(()=>validateStoneViewportHost(host),/frame subscription/);
 assert.throws(()=>validateStoneViewportHost(host,{frameDriver:'typo'}),/frame driver/i);
 host.device={};assert.throws(()=>validateStoneViewportHost(host,{frameDriver:'manual'}),/effective viewport device/);
});
test('manual bounded advancement leaves positions and topology unpublished until explicit publication',async()=>{
 const calls=[],observed={model:{points:1},state:[],bonds:[],steps:0};
 const context={producerMode:true,busy:false,closing:false,failure:null,bounded:true,gesture:null,configuration:{},observed,components:[],residentGrip:{clearChanges(){calls.push('clear');}},residentSupport:null,chunkMotion:null,
  resident:{step:async()=>{calls.push('step');return {totalMilliseconds:1};},read:async()=>{calls.push('readback');return observed;},submittedState:()=>({runId:'native-fixture',steps:1})},materialComponents:()=>[],acquiredConnections:()=>[],
  pieces:[{exposure:{prepare(){calls.push('prepare-topology');},update(){calls.push('publish-topology');}}}],applyFloorContact(){calls.push('floor');},present(){calls.push('publish-pose');},observeSurface:async()=>calls.push('readback'),timings:[],performance,$:()=>({value:180,textContent:''}),fail(error){throw error;}};
 vm.runInNewContext(source.slice(source.indexOf('async function advance('),source.indexOf('function ray(')),context);
 await context.advance();
 assert.ok(calls.includes('step'));assert.ok(calls.includes('prepare-topology'));
 assert.equal(calls.includes('publish-pose'),false);assert.equal(calls.includes('publish-topology'),false);assert.equal(calls.includes('readback'),false);
 await assert.rejects(context.advance({publish:false,evidence:true}),/published.*evidence|evidence.*publication/i);
});
test('producer roots are unparented and manual participation never subscribes to host frames',()=>{
 const calls=[],scene={name:'',position:{fromArray(){}}},container={add:root=>calls.push(root)},context={producerMode:true,host:{scene:container},THREE:{Group:class{constructor(){return scene;}}},AbortController};
 const start=source.indexOf('const lifetime='),end=source.indexOf('\nconst camera=',start);
 vm.runInNewContext(source.slice(start,end),context);assert.deepEqual(calls,[]);
 const tail=source.slice(source.indexOf(' if(host){unsubscribeFrames='),source.indexOf('\n return api;',source.indexOf(' if(host){unsubscribeFrames=')));
 vm.runInNewContext(tail,{producerMode:true,host:{subscribeFrame(){calls.push('subscribe');}},draw(){calls.push('draw');}});assert.deepEqual(calls,[]);
});
test('publication refuses an incomplete step and publishes once without advancing physics',()=>{
 const context={api:{},pieces:[],closing:false,busy:true,pendingPick:false,finishing:false,failure:null,present(){context.count++;},count:0,observed:{runId:'r',steps:3}};
 const start=source.indexOf(' api.publish='),end=source.indexOf('\n api.quiesce=',start);
 assert.ok(start>=0&&end>start,'explicit publication and shutdown API required');
 vm.runInNewContext(source.slice(start,end),context);
 assert.equal(context.api.publish().status,'pending');assert.equal(context.count,0);
 context.busy=false;const result=context.api.publish();assert.equal(result.status,'published');assert.equal(result.steps,3);assert.equal(context.count,1);
});
test('exposure preparation latches dirty topology without rebuilding visible index or draw buffers',async()=>{
 const passes=[],device={limits:{maxStorageBufferBindingSize:1e8},queue:{writeBuffer(){},submit(){}},createBuffer:({size})=>({size,destroy(){}}),createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createComputePipelineAsync:async({compute})=>({entryPoint:compute.entryPoint}),createBindGroup:()=>({}),createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(pipeline){passes.push(pipeline.entryPoint);},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})})};
 globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,INDEX:8,INDIRECT:16};globalThis.GPUShaderStage={COMPUTE:1};
 const renderer={backend:{device,get:()=>({}),delete(){}}},shell=buildFixedCellShell({positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],bonds:[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]].flatMap(([a,b])=>[a,b,1,0])});
 const exposure=await createGpuExposedFaces(renderer,shell,{setIndex(){}},{ownershipBuffer:{},connectionBuffer:{},changeBuffer:{}});
 assert.equal(typeof exposure.prepare,'function','deferred publication needs a GPU dirty latch');
 exposure.prepare();assert.deepEqual(passes,['latch']);passes.length=0;exposure.update();assert.deepEqual(passes,['clear','expose','finish']);exposure.dispose();
});
test('quiescence drains pending input and GPU work without destroying or removing the scene',async()=>{
 const calls=[],api={},controls={enabled:true},context={api,quiescence:null,closing:false,paused:false,lifetime:{abort(){calls.push('abort');}},unsubscribeFrames(){calls.push('unsubscribe');},frameRequest:null,gestureGeneration:0,pointerContact:null,pendingPick:false,gesture:null,pickTask:Promise.resolve(),settle:async()=>calls.push('settle'),resident:{release:async()=>calls.push('release')},device:{queue:{onSubmittedWorkDone:async()=>calls.push('completion')}},controls,previousControlsEnabled:false,AggregateError};
 const start=source.indexOf(' api.quiesce='),end=source.indexOf('\n api.viewport=',start);
 assert.ok(start>=0&&end>start,'retained-resource shutdown required');vm.runInNewContext(source.slice(start,end),context);
 const first=api.quiesce();assert.equal(first,api.quiesce());assert.equal((await first).resourcesRetained,true);
 assert.deepEqual(calls,['abort','unsubscribe','settle','release','completion']);assert.equal(controls.enabled,false);
});
