import {createFluidViewportHost} from './fluid-viewport-host.mjs';
import {createFluidAnalyticalSupport} from './fluid-analytical-support.mjs';
import * as THREE from './lib/three.webgpu.js';
import {
  createWebGPUFingerFluidSolver,
  KAMINOS_FINGER_FLUID_LOCAL_HOST_FRAME_ROUTE as ROUTE,
} from './finger-fluid-webgpu-core.js';
import { normalizeLocalLiquidSetup, localLiquidInletPacket } from './local-liquid-setup.mjs';

const PIPELINE = 'kaminos/local-liquid-authoring-v0';



export async function createLocalLiquidHost({renderer, scene, camera, pipeline, device, setup, emitters = [], isCurrent = () => true, sceneGeneration = 0, onContactRetired = () => {}, helperGround = null}) {
  if (!device || renderer.backend.device !== device) throw Error('Local liquid requires the host WebGPU device');
  let authored = normalizeLocalLiquidSetup(setup), authoredEmitters = structuredClone(emitters), sourceGeneration = 1;
  const initialPacket=localLiquidInletPacket(authored,authoredEmitters,sourceGeneration);
  let publishedEmitterKey=JSON.stringify(initialPacket.emitters);
  const material={particleRepulsionStrength:1,capillaryStrength:.72,freeFlightViscosityBoost:.17,...authored.materialControls,densityIterations:authored.densityIterations};
  const solver = await createWebGPUFingerFluidSolver({webgpuDevice:device, hostFrameComposition:true,
    hostFramePipelineIdentity:PIPELINE, presentationMode:'local_analytic_consumer', truthScene:'live_hand_inlets',
    particleCount:authored.particleCount, ...material,
    rendererMode:'screen_space_refraction', bodyTransportMode:'robust_dense_body', interfaceFrequencyMode:'macro_micro_separated',
    liveInletPacket:initialPacket, liquidFireContactCoverage:'active-liquid-particles'});
  if (!isCurrent()) {
    solver.destroy?.();
    return null;
  }
  if (!solver.available) throw Error(solver.reason || 'Local liquid solver unavailable');
  const group = createFluidAnalyticalSupport(); scene.add(group);
  const viewport=createFluidViewportHost({renderer,scene,camera,pipeline,device,solver,group,helperGround,pipelineIdentity:PIPELINE});
  let disposed=false;

  const host = {group,render:options=>viewport.render(options),
    setOpticalDebugForWitness:value=>viewport.setOpticalDebugForWitness(value),
    setSupportVisibleForWitness(value) {group.visible=Boolean(value);},
    readBackgroundDepthForWitness:()=>viewport.readBackgroundDepthForWitness(),
    contactFrame() {
      const {failure,paused,lastFrame}=viewport.state();
      if(disposed || failure || paused || !lastFrame)return null;
      const descriptor=solver.getLiquidFireContactDescriptor();
      if(descriptor.writeTick<1)return null;
      return {schema:'kaminos.authored-liquid-contact-frame.v1',hostFrameId:lastFrame.frameId,
        sceneGeneration,sourceGeneration,sourceIds:authoredEmitters.map(record=>record.id),
        producerTick:descriptor.writeTick,descriptor};
    },
    setEmitters(records) {
      const packet=localLiquidInletPacket(authored,records,sourceGeneration+1);
      const key=JSON.stringify(packet.emitters);
      // Gizmo selection/hover also reconciles sources. Republish only a real
      // inlet change: every solver publication restarts its release epoch.
      if (key===publishedEmitterKey) {authoredEmitters=structuredClone(records);return false;}
      solver.setLiveInletPacket(packet);
      authoredEmitters=structuredClone(records);
      publishedEmitterKey=key;
      sourceGeneration++;
      return true;
    },
    setSetup(nextSetup) {
      const next=normalizeLocalLiquidSetup(nextSetup);
      if (!next) throw Error('Local liquid setup cannot be cleared while its host is mounted');
      solver.setLiveInletPacket(localLiquidInletPacket(next,authoredEmitters,sourceGeneration+1));
      sourceGeneration++;
      authored=next;
    },
    getMaterialControls:()=>solver.getMaterialControls(),
    readMaterialInputs:()=>solver.readMaterialInputs(),
    setMaterialControls(patch){
      const receipt=solver.setMaterialControls(patch);
      const {densityIterations,...materialControls}=receipt.effective;
      authored=normalizeLocalLiquidSetup({...authored,densityIterations,materialControls});
      return receipt;
    },
    setPaused:value=>viewport.setPaused(value),
    get paused(){return viewport.paused;},
    state:()=>{const state=viewport.state();return {requestedRoute:ROUTE,effectiveRoute:state.frameCount&&!state.failure?ROUTE:null,registered:true,mounted:true,
      ...state,setup:structuredClone(authored),solver:solver.getDebugState()};},
    dispose() {
      onContactRetired(host);
      disposed=true;viewport.dispose();solver.destroy(); scene.remove(group);
      const materials=new Set(); group.traverse(child=>{child.geometry?.dispose();if(child.material)materials.add(child.material);});
      for(const material of materials)material.dispose();

    }};
  return host;
}
