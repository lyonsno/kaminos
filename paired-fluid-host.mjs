import * as THREE from './lib/three.webgpu.js';
import {texture,uv,vec2,uniform} from './lib/three.tsl.js';
import {createWebGPUFingerFluidSolver} from './finger-fluid-webgpu-core.js';
import {createFluidViewportHost} from './fluid-viewport-host.mjs';
import {createFluidBenchScene,FINGER_FLUID_BENCH_VIEWPORT_PIPELINE} from './finger-fluid-bench-viewport.mjs';
import {applyFluidOwnerSetup} from './fluid-owner-host.mjs';
import {assertPressureLaunchState} from './experiments/paper-fluid/pressure-launch.mjs';
import {createSceneEmissiveCamera} from './scene-emissive-camera.mjs';
import {vec3,vec4,float} from './lib/three.tsl.js';

let nextGeneration=1;
export function readPairedFluidArm(setup,{runtime,pressure},identity){
 assertPressureLaunchState(setup,{runtime,clock:{fixedTimeStepSeconds:setup.dt}});
 if(pressure?.dt!==Math.fround(setup.dt)&&pressure?.dt!==setup.dt)throw Error('Native pair timestep does not match the declared fixed clock');
 if(runtime.adapterInfo?.isFallbackAdapter!==false)throw Error('Paired comparison requires a verified native adapter');
 return {...identity,step:runtime.stepCount,dt:setup.dt,physicsTimestepSeconds:pressure.dt,settings:runtime.ipbfSettings,particleCount:runtime.particleCount,pressurePasses:runtime.densityIterationsPerStep,backend:runtime.solver_backend,adapter:runtime.adapterInfo};
}

export async function createPairedFluidHost({setups,renderer,scene,camera,pipeline,helperGround,getDisplayPolicy,redraw,onFrame}){
 if(!Array.isArray(setups)||setups.length!==2)throw Error('Paired fluid requires two complete setups');
 for(const setup of setups)applyFluidOwnerSetup({},setup);
 if(setups[0].dt!==setups[1].dt)throw Error('This comparison requires equal fixed physics timesteps');
 if(JSON.stringify(setups[0].support)!==JSON.stringify(setups[1].support))throw Error('Paired views require the same support geometry');
 const device=renderer.backend.device,solvers=[],views=[];let support=null,compositor=null,closed=false,shown=null,failure=null;const generation=nextGeneration++;
 const cleanup=()=>{for(const view of views)view.dispose();for(const solver of solvers)solver.destroy();support?.dispose();compositor?.dispose();};
 try{
  for(let i=0;i<2;i++){
   const setup=setups[i],solver=await createWebGPUFingerFluidSolver({...setup.solver,canvas:renderer.domElement,webgpuDevice:device,hostFrameComposition:true,hostFramePipelineIdentity:FINGER_FLUID_BENCH_VIEWPORT_PIPELINE,presentationMode:'local_analytic_consumer',simulationStepSeconds:setup.dt});
   if(!solver.available){solver.destroy?.();throw Error(`Arm ${i+1} startup failed: ${solver.reason}`);}solvers.push(solver);
  }
  support=createFluidBenchScene({scene,truthScene:setups[0].solver.truthScene,support:setups[0].support});
  for(let i=0;i<2;i++)views.push(createFluidViewportHost({renderer,scene,camera,pipeline,device,solver:solvers[i],group:support.group,helperGround,getDisplayPolicy,pipelineIdentity:FINGER_FLUID_BENCH_VIEWPORT_PIPELINE,framePrefix:'pair-arm-'+i}));
  const split=uniform(.5),coord=uv();
  const output=coord.x.lessThan(split).select(texture(views[0].output().texture,vec2(coord.x.div(split),coord.y)),texture(views[1].output().texture,vec2(coord.x.sub(split).div(split.oneMinus()),coord.y)));
  compositor=new THREE.RenderPipeline(renderer,output);
  const finalCamera=createSceneEmissiveCamera(output,{TSL:{uniform,vec3,vec4,float},THREE});
  const read=()=>{if(closed)throw Error('Paired fluid host disposed');return solvers.map((s,i)=>({...readPairedFluidArm(setups[i],{runtime:s.getDebugState(),pressure:s.getPressureControls()},{id:'fluid-arm-'+i,generation}),history:s.renderHistoryState(),viewport:views[i].state(),failure}));};
  read();
  return{dt:setups[0].dt,read,
   capture(){const frames=[];try{for(const solver of solvers)frames.push(solver.captureRenderFrame());return frames;}catch(error){for(const frame of frames)frame.release();throw error;}},
   async advance(i){if(closed||failure)throw Error(failure||'Paired fluid host disposed');const before=solvers[i].getDebugState().stepCount;solvers[i].step(setups[i].dt);await device.queue.onSubmittedWorkDone();if(solvers[i].getDebugState().stepCount!==before+setups[i].solver.substeps)throw Error('Arm did not advance its fixed timestep');},
   show(frames){if(closed)throw Error('Paired fluid host disposed');if(frames.length!==2||frames[0].step!==frames[1].step)throw Error('Render frames are not aligned');shown=frames;support.update(frames[0].step);redraw();},
   onFrame,
   render(){
    if(closed||!shown)return;if(failure)throw Error(failure);
    const size=renderer.getDrawingBufferSize(new THREE.Vector2()),left=Math.floor(size.x/2),right=size.x-left,aspect=camera.aspect;
    if(left<1||size.y<1)return;
    try{
     for(let i=0;i<2;i++){const width=i===0?left:right;camera.aspect=width/size.y;camera.updateProjectionMatrix();views[i].render({advance:false,present:false,extent:{width,height:size.y},renderOptions:{rendererMode:'screen_space_refraction',retainedRenderFrame:shown[i]}});}
     split.value=left/size.x;
     const cameraState=getDisplayPolicy?.()?.cameraState??{effective:false};
     finalCamera.update(cameraState.effective,{...cameraState,effective:'emissive-transport-v2'});
     const finalOutput=cameraState.effective?finalCamera.outputNode:output,transform=!cameraState.effective;
     if(compositor.outputNode!==finalOutput||compositor.outputColorTransform!==transform){compositor.outputNode=finalOutput;compositor.outputColorTransform=transform;compositor.needsUpdate=true;}
     compositor.render();
    }catch(error){failure=error.message;throw error;}
    finally{camera.aspect=aspect;camera.updateProjectionMatrix();}
   },
   state:()=>({failure,displayedSteps:shown?.map(f=>f.step)??null,closed}),
   async dispose(){if(closed)return;closed=true;await device.queue.onSubmittedWorkDone().catch(()=>{});cleanup();redraw();},
  };
 }catch(error){cleanup();throw error;}
}
