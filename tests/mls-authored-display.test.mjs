// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const draws=[];let target=null;
class Pipeline{constructor(renderer,outputNode){this.outputNode=outputNode;this.outputColorTransform=true;}render(){draws.push({node:this.outputNode,transform:this.outputColorTransform,target});}dispose(){}}
class Target{constructor(){this.texture={};}setSize(){}dispose(){}}
const raw={isNode:true,name:'raw'},outlined={name:'outlined'},linear={name:'water'},matched={name:'matched'};
const THREE={RenderPipeline:Pipeline,RenderTarget:Target,NodeMaterial:class{dispose(){}},Color:class{},Vector2:class{},Matrix3:class{},HalfFloatType:1,FloatType:2,RedFormat:3};
const display={update:()=>({effective:true}),outputNode:matched};
const decorateOutput=node=>({decorated:node});
const renderer={backend:{get:()=>({texture:{createView:()=>({})}})},getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},getRenderObjectFunction:()=>null,setRenderObjectFunction(){},getClearColor:()=>({}),getClearAlpha:()=>1,setClearColor(){},getDrawingBufferSize:()=>({x:100,y:100}),initRenderTarget(){},render(){},copyTextureToTexture(){}};
const solver={config:{},read:()=>({clock:{step:0}}),setPacket(){},setSceneColliders(){},advance(){},dispose(){}};
const device={addEventListener(){},removeEventListener(){},lost:new Promise(()=>{}),createCommandEncoder:()=>({finish:()=>({})}),queue:{submit(){}}};renderer.backend.device=device;
const context={THREE,texture:()=>linear,positionView:{z:{negate:()=>0}},vec4:()=>({}),createSceneEmissiveCamera:()=>display,applySceneEmissiveCamera:(p,o,m,e)=>{p.outputNode=e?m:o;p.outputColorTransform=!e;},
 createMlsJuiceSolver:async()=>solver,createMlsJuiceRenderer:async()=>({encode(){},read:()=>({}),dispose(){}}),createMlsWaterProxy:async()=>({dispose(){}}),
 createFluidSceneEnvironment:()=>({render(){},view:()=>({}),state:()=>({}),dispose(){}}),localLiquidPresentationPlan:()=>({}),MLS_ROUTE:'mls',MLS_SOURCE:'test',structuredClone,WeakMap,uniform(){},vec3(){},float(){},Fn(){},agxToneMapping(){}};
vm.createContext(context);
const load=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
vm.runInContext(load('local-liquid-scene-passes.mjs')+load('authored-mls-host.mjs'),context);
const host=await context.createAuthoredMlsHost({renderer,scene:{},camera:{far:100},pipeline:new Pipeline(renderer,outlined),device,initial:{solver:{},sourceIds:[],sourceRecords:[]},makePacket:()=>({}),getDisplayPolicy:()=>({rawOutput:raw,cameraState:{effective:true}}),decorateOutput});
for(const mode of ['full','proxy','hidden']){host.setPresentation(mode);host.setSceneCamera?.(true,{});draws.length=0;host.render({advance:false});
 assert.equal(draws[0].node,raw,mode+' must capture undecorated scene radiance');assert.equal(draws[0].transform,false);
 assert.equal(draws.at(-1).node.decorated,matched,mode+' must retain the selected scene camera');assert.equal(draws.at(-1).transform,false);
 assert.equal(draws.length,2,'one capture and one final selection decoration');}
host.dispose();console.log('MLS full/proxy/hidden share raw capture and one matched-camera presentation');
