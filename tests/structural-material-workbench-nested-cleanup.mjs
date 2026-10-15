import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {disposeStoneAssets} from '../structural-material-arch-stones.js';
import {createGpuBoundedSurface} from '../structural-material-bounded-gpu.js';
import {createStoneWorkbenchCapability} from '../structural-material-workbench-host.mjs';
let transportModule;
if(process.env.STONE_TRANSPORT_REVISION){let source=execFileSync('git',['show',process.env.STONE_TRANSPORT_REVISION+':structural-material-component-gpu-transport.js'],{encoding:'utf8'});for(const specifier of ['three/webgpu','three/tsl','./structural-material-component-transport.mjs','./structural-material-bounded-fragments.mjs'])source=source.replace(JSON.stringify(specifier).replaceAll('"',"'"),JSON.stringify(specifier.startsWith('.')?new URL('../'+specifier.slice(2),import.meta.url).href:import.meta.resolve(specifier)));transportModule=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}else transportModule=await import('../structural-material-component-gpu-transport.js');
const {createGpuTransport}=transportModule;
import {COMPONENT_TRANSPORT_ROUTE} from '../structural-material-component-transport.mjs';

test('asset cleanup attempts later material and texture after geometry rejection',()=>{
 const calls=[],resource=(name,fail=false)=>({dispose(){calls.push(name);if(fail)throw Error(name+' rejected');}}),texture={...resource('texture'),isTexture:true},material={...resource('material'),map:texture};
 assert.throws(()=>disposeStoneAssets([{geometry:resource('geometry',true),scene:{traverse:visit=>visit({material})}}]),/rejected/);
 assert.deepEqual(calls,['geometry','material','texture']);
});
test('actual bounded surface cleanup continues after its nested picker fails',async()=>{
 const calls=[],attributes=new WeakMap();globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};globalThis.GPUShaderStage={COMPUTE:1};
 const device={limits:{maxStorageBufferBindingSize:1e8},queue:{writeBuffer(){}},createBuffer:({label,size})=>({size,destroy(){calls.push(label);if(label==='Bounded pick triangles')throw Error('picker rejected');}}),createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBindGroup:()=>({}),createBindGroupLayout:()=>({}),createPipelineLayout:()=>({})};
 const renderer={backend:{isWebGPUBackend:true,device,get:attribute=>{if(!attributes.has(attribute))attributes.set(attribute,{});return attributes.get(attribute);},destroyAttribute(){calls.push('attribute');},delete(){calls.push('output attribute');}}},resident={device,bondBuffer:()=>({}),stateBuffer:()=>({})},binding={route:'kaminos.bounded-fragment-binding.v0',fixedCellShell:true,entries:[{subset:[0],anchor:0,edgeIds:Array(6).fill(0xffffffff),rest:[0,0,0]}]};
 const {BOUNDED_FRAGMENT_ROUTE}=await import('../structural-material-bounded-fragments.mjs');binding.route=BOUNDED_FRAGMENT_ROUTE;binding.points=1;
 const surface=await createGpuBoundedSurface(renderer,resident,binding,[0,0,0],[{}]);surface.materials[0].dispose=()=>calls.push('material');
 assert.throws(()=>surface.dispose(),/rejected/);
 for(const name of ['Bounded pick triangles','Bounded pick ray','Bounded pick result','material','output attribute','bounded local visual ownership','bounded visual pose'])assert.ok(calls.includes(name),name+' cleanup omitted');
});
test('actual runtime failure reporter preserves disabled borrowed controls after incomplete cleanup',async()=>{
 const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),calls=[],object=name=>({geometry:{dispose(){calls.push(name);if(name==='support')throw Error('destructor rejected');}},material:{dispose(){}}}),controls={enabled:false},api={object:{userData:{}},experimentStatus:()=>({route:'kaminos.picked-stone.bounded-shards.webgpu.v0',backend:'webgpu',adapterFallback:false,connectivity:'elastic-support',runId:'fixture',submittedSteps:0,failure:null}),pause(){},release:async()=>{}};
 const context={api,closing:false,paused:false,failure:null,lifetime:{abort(){}},unsubscribeFrames(){},frameRequest:null,gestureGeneration:0,pointerContact:null,pendingPick:false,gesture:null,disposal:null,pickTask:Promise.resolve(),settle:async()=>{},resident:{release:async()=>{},dispose(){}},device:{queue:{onSubmittedWorkDone:async()=>{}}},pieces:[],residentContact:null,chunkMotion:null,ground:null,residentGrip:null,residentSupport:null,surface:null,support:object('support'),marker:object('marker'),arrow:object('arrow'),capMaterial:{dispose(){}},assets:[],disposeStoneAssets(){},container:{remove(){calls.push('removed');}},scene:{},controls,previousControlsEnabled:false,host:{},AggregateError,$:()=>({textContent:''})};
 const failure=source.slice(source.indexOf('const fail=e=>'),source.indexOf('\nconst settle=',source.indexOf('const fail=e=>')));context.quiescence=null;vm.runInNewContext(failure+'\napi.reportFailure=fail;'+source.slice(source.indexOf('api.quiesce=()=>'),source.indexOf(' api.viewport='))+source.slice(source.indexOf('api.dispose=()=>'),source.indexOf(' if(host){unsubscribeFrames=')),context);
 const document={createElement:()=>({style:{},setAttribute(){},append(){},remove(){}})},capability=createStoneWorkbenchCapability({document},{createRuntime:async()=>api}),handle=await capability.stone.open();
 await assert.rejects(handle.dispose(),/destructor rejected/);assert.equal(controls.enabled,false);assert.equal(capability.current(),api);assert.ok(api.disposalStatus().errors.some(error=>error.message==='destructor rejected'));assert.ok(calls.includes('removed'));
});
test('alternative transport also attempts all owned cleanup after an early material failure',()=>{
 const calls=[],device={createBuffer:()=>({destroy(){calls.push('published pose');}})},backend={isWebGPUBackend:true,device,get:()=>({buffer:{}}),destroyAttribute(){calls.push('attribute');},delete(){calls.push('points');}},resident={device,stateBuffer:()=>({size:64})},binding={route:COMPONENT_TRANSPORT_ROUTE,points:1,entries:[{ids:[0],weights:[1],offset:[0,0,0]}]};
 globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2};
 const surface=createGpuTransport({backend},resident,binding,[0],[{},{}]);surface.materials[0].dispose=()=>{calls.push('first material');throw Error('material rejected');};surface.materials[1].dispose=()=>calls.push('second material');
 assert.throws(()=>surface.dispose(),/material rejected/);assert.ok(calls.includes('second material'));assert.equal(calls.filter(name=>name==='attribute').length,4);assert.ok(calls.includes('points'));assert.ok(calls.includes('published pose'));
});
