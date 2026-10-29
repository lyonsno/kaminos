import fs from 'node:fs';
import vm from 'node:vm';
import {createMlsClock,MLS_ROUTE,MLS_SOURCE} from '../../mls-juice-contract.mjs';
import {authoredMlsSetup,authoredMlsInlets} from '../../authored-mls-water.mjs';

// Unit fixture for the production host; substitute GPU resources only. Real
// allocation, dispatch and presentation remain the native witness's job.
export async function createAuthoredMlsHostFixture() {
  let target=null;
  const clock=createMlsClock(1/240);
  const solver={config:{},read:()=>({clock:clock.read(),particleCount:1000}),
    setPacket(){},setSceneColliders(){},setPaused(value){clock.observe(0,value);},
    async advanceTo(step){clock.advanceSteps(step-clock.read().step);return clock.read();},
    advance(){},dispose(){}};
  class Pipeline {render(){}dispose(){}}
  class Target {constructor(){this.texture={};}setSize(){}dispose(){}}
  const THREE={RenderPipeline:Pipeline,RenderTarget:Target,NodeMaterial:class{dispose(){}},Color:class{},Vector2:class{}};
  const renderer={backend:{get:()=>({texture:{createView:()=>({})}})},getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},
    getRenderObjectFunction:()=>null,setRenderObjectFunction(){},getClearColor:()=>({}),getClearAlpha:()=>1,setClearColor(){},
    getDrawingBufferSize:()=>({x:100,y:100}),initRenderTarget(){},render(){},copyTextureToTexture(){}};
  const device={addEventListener(){},removeEventListener(){},lost:new Promise(()=>{}),
    createCommandEncoder:()=>({finish:()=>({})}),queue:{submit(){}}};
  renderer.backend.device=device;
  const context={THREE,texture:()=>({}),positionView:{z:{negate:()=>0}},vec4:()=>({}),
    createLocalLiquidScenePasses:()=>({update(){},state:()=>({camera:{transform:'test'}}),capture:new Pipeline(),presentation:new Pipeline(),dispose(){}}),
    createMlsJuiceSolver:async()=>solver,createMlsJuiceRenderer:async()=>({encode(){},read:()=>({}),dispose(){}}),createMlsWaterProxy:async()=>({dispose(){}}),
    createFluidSceneEnvironment:()=>({render(){},view:()=>({}),state:()=>({}),dispose(){}}),
    localLiquidPresentationPlan:()=>({}),MLS_ROUTE,MLS_SOURCE,authoredMlsSetup,authoredMlsInlets,structuredClone};
  vm.createContext(context);
  const load=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
  vm.runInContext(load('authored-mls-host.mjs')+load('authored-water-host.mjs').replace(" const {createAuthoredMlsHost}=await import('./authored-mls-host.mjs');",''),context);
  const emitters=[{id:'A',type:'local-liquid-emitter',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width:.5,samplesPerUnit:20}}}];
  const host=await context.createAuthoredWaterHost({renderer,scene:{},camera:{far:100},pipeline:new Pipeline(),device,emitters});
  return {host,solver};
}
