import * as THREE from './lib/three.webgpu.js';
import {
  createWebGPUFingerFluidSolver, sampleFingerFluidPlaygroundHeight, fingerFluidAnalyticalSupportGeometry,
  KAMINOS_FINGER_FLUID_LOCAL_HOST_FRAME_ROUTE as ROUTE,
} from './finger-fluid-webgpu-core.js';
import { normalizeLocalLiquidSetup, localLiquidInletPacket } from './local-liquid-setup.mjs';
import {createFluidViewportHost} from './fluid-viewport-host.mjs';

const PIPELINE = 'kaminos/local-liquid-authoring-v0';

function supportMesh() {
  const {boundsMin, boundsMax, obstacle} = fingerFluidAnalyticalSupportGeometry();
  // Same 64-cell surface sampling as the retained analytical presentation.
  const geometry = new THREE.PlaneGeometry(boundsMax[0]-boundsMin[0], boundsMax[2]-boundsMin[2], 64, 64);
  geometry.rotateX(-Math.PI/2);
  const positions = geometry.attributes.position;
  for (let i=0; i<positions.count; i++) positions.setY(i, sampleFingerFluidPlaygroundHeight(positions.getX(i), positions.getZ(i)));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({color:0x74898a, roughness:.65, metalness:.05, side:THREE.DoubleSide});
  const group = new THREE.Group(); group.name = 'Local analytical basin';
  group.add(new THREE.Mesh(geometry, material));
  const rock = new THREE.Mesh(new THREE.SphereGeometry(obstacle.radius, 32, 24), material);
  rock.position.fromArray(obstacle.center); group.add(rock);
  return group;
}

export async function createLocalLiquidHost({renderer, scene, camera, device, setup, emitters = [], isCurrent = () => true, getDisplayPolicy, decorateOutput}) {
  if (!device || renderer.backend.device !== device) throw Error('Local liquid requires the host WebGPU device');
  if(typeof getDisplayPolicy!=='function'||typeof decorateOutput!=='function')
    throw Error('Local liquid requires scene lighting and presentation bindings');
  let authored = normalizeLocalLiquidSetup(setup), authoredEmitters = structuredClone(emitters), sourceGeneration = 1;
  const initialPacket=localLiquidInletPacket(authored,authoredEmitters,sourceGeneration);
  let publishedEmitterKey=JSON.stringify(initialPacket.emitters);
  const solver = await createWebGPUFingerFluidSolver({webgpuDevice:device, hostFrameComposition:true,
    hostFramePipelineIdentity:PIPELINE, presentationMode:'local_analytic_consumer', truthScene:'live_hand_inlets',
    particleCount:authored.particleCount, densityIterations:authored.densityIterations,
    rendererMode:'screen_space_refraction', bodyTransportMode:'robust_dense_body', interfaceFrequencyMode:'macro_micro_separated',
    liveInletPacket:initialPacket});
  if (!isCurrent()) {
    solver.destroy?.();
    return null;
  }
  if (!solver.available) throw Error(solver.reason || 'Local liquid solver unavailable');
  const group = supportMesh(); group.visible=authored.showSupportGeometry; scene.add(group);
  const viewport=createFluidViewportHost({renderer,scene,camera,device,solver,getDisplayPolicy,decorateOutput,pipelineIdentity:PIPELINE});
  let paused=false,disposed=false,failure=null;
  function render({advance=true}={}) {
    if(disposed)throw Error('Local liquid host disposed');
    if(failure||viewport.state().failure)throw Error(failure||viewport.state().failure);
    try {
      if(advance&&!paused)solver.step(1/60);
      viewport.render();
    } catch(error) {failure=error.message||String(error);throw error;}
  }
  return {group,render,readSceneColor:viewport.readSceneColor,
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
      const packet=localLiquidInletPacket(next,authoredEmitters,sourceGeneration+1);
      const key=JSON.stringify(packet.emitters);
      if(key!==publishedEmitterKey) {
        solver.setLiveInletPacket(packet);
        publishedEmitterKey=key;
        sourceGeneration++;
      }
      group.visible=next.showSupportGeometry;
      authored=next;
    },
    setPaused(value){paused=Boolean(value);return paused;},
    get paused(){return paused;},
    state:()=>{const state=viewport.state();return {...state,registered:true,mounted:true,
      effectiveRoute:state.frameCount&&!failure&&!state.failure?ROUTE:null,
      paused,failure:failure||state.failure,setup:structuredClone(authored),supportGeometryVisible:group.visible,sourceGeneration,
      lastFrame:state.lastFrame&&{...state.lastFrame,simulationTimePolicy:'one-fixed-1/60-step-per-rendered-frame',simulationRewind:false},solver:solver.getDebugState()};},
    dispose() {
      if(disposed)return;
      disposed=true;viewport.dispose();solver.destroy();scene.remove(group);
      const materials=new Set();group.traverse(child=>{child.geometry?.dispose();if(child.material)materials.add(child.material);});
      for(const material of materials)material.dispose();
    }};
}
