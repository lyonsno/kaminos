import * as THREE from './lib/three.webgpu.js';
import { texture, vec4, positionView, pmremTexture, equirectDirection, uv, uniform } from './lib/three.tsl.js';
import {
  createWebGPUFingerFluidSolver, sampleFingerFluidPlaygroundHeight, fingerFluidAnalyticalSupportGeometry,
  KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE as SUPPORT,
  KAMINOS_FINGER_FLUID_LOCAL_HOST_FRAME_ROUTE as ROUTE,
  KAMINOS_FINGER_FLUID_LOCAL_HOST_FRAME_SCHEMA as FRAME_SCHEMA,
} from './finger-fluid-webgpu-core.js';
import { normalizeLocalLiquidSetup, localLiquidInletPacket } from './local-liquid-setup.mjs';
import { localLiquidPresentationPlan } from './local-liquid-presentation.mjs';

const PIPELINE = 'kaminos/local-liquid-authoring-v0';

// Replacement hosts overlap until their admission succeeds. All owners retain
// the ordinary scene transform, rather than snapshotting another host's mode.
const pipelineOutputTransforms=new WeakMap();
function retainLinearOutput(pipeline){
 let state=pipelineOutputTransforms.get(pipeline);
 if(!state){state={original:pipeline.outputColorTransform,owners:0};pipelineOutputTransforms.set(pipeline,state);}
 state.owners++;pipeline.outputColorTransform=false;pipeline.needsUpdate=true;
 let released=false;
 return ()=>{if(released)return;released=true;if(--state.owners===0){pipeline.outputColorTransform=state.original;pipeline.needsUpdate=true;pipelineOutputTransforms.delete(pipeline);}};
}


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

function cameraFrame(camera, width, height, generation) {
  camera.updateMatrixWorld();
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const basis = camera.matrixWorld.elements;
  return {schema:'kaminos.finger-fluid.external-camera.v0', identity:camera.uuid, generation,
    projectionType:camera.isPerspectiveCamera ? 'perspective' : 'orthographic',
    view:camera.matrixWorldInverse.toArray(), projection:camera.projectionMatrix.toArray(),
    viewProjection:viewProjection.toArray(), inverseViewProjection:viewProjection.clone().invert().toArray(),
    position:camera.position.toArray(), right:basis.slice(0,3), up:basis.slice(4,7), forward:basis.slice(8,11).map(v=>-v),
    near:camera.near, far:camera.far, viewport:{width,height}};
}

export async function createLocalLiquidHost({renderer, scene, camera, pipeline, device, setup, emitters = [], isCurrent = () => true}) {
  if (!device || renderer.backend.device !== device) throw Error('Local liquid requires the host WebGPU device');
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
  const targetOptions = {type:THREE.HalfFloatType, depthBuffer:false, minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter};
  const colorTarget = new THREE.RenderTarget(1,1,targetOptions);
  const outputTarget = new THREE.RenderTarget(1,1,targetOptions);
  const depthTarget = new THREE.RenderTarget(1,1,{type:THREE.FloatType,format:THREE.RedFormat,depthBuffer:true,
    minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  colorTarget.texture.name='Local liquid host color'; outputTarget.texture.name='Local liquid composed color';
  depthTarget.texture.name='Local liquid host linear depth';
  const depthMaterial = new THREE.NodeMaterial(); depthMaterial.fragmentNode=vec4(positionView.z.negate(),0,0,1);
  depthMaterial.blending=THREE.NoBlending; depthMaterial.toneMapped=false; depthMaterial.side=THREE.DoubleSide;
  const presentation = new THREE.RenderPipeline(renderer,texture(outputTarget.texture));
  const releaseOutputTransform=retainLinearOutput(pipeline);
  const environmentRotation=uniform(new THREE.Matrix3()), environmentIntensity=uniform(1);
  let environmentTarget=null, environmentQuad=null, environmentSource=null, environmentKey=null, environmentGeneration=0;
  let frameCount=0, paused=false, failure=null, lastFrame=null, disposed=false, presentationMode='full', proxyStepEvery=1;
  const onGpuError=event=>{failure=event.error?.message || 'Host WebGPU error';};
  device.addEventListener('uncapturederror',onGpuError);
  device.lost.then(info=>{if(!disposed)failure=info.message || 'Host WebGPU device lost';});
  const nativeTexture = target => renderer.backend.get(target.texture).texture;

  function renderEnvironment() {
    const source=scene.environment;
    if (!source) throw Error('Local liquid host environment is missing');
    const key=JSON.stringify([source.uuid,source.version,scene.environmentIntensity,scene.environmentRotation.toArray()]);
    if (key===environmentKey) return;
    if (source!==environmentSource) {
      environmentTarget?.dispose(); environmentQuad?.material.dispose();
      // Keep the current host PMREM atlas width; no lower private environment.
      const width=source.image?.width;
      if (!Number.isInteger(width) || width<2) throw Error('Host environment extent unavailable');
      environmentTarget=new THREE.RenderTarget(width,Math.ceil(width/2),targetOptions);
      const material=new THREE.NodeMaterial(); material.toneMapped=false;
      // The retained sampler uses v=acos(worldY)/PI: north is the top row.
      material.fragmentNode=vec4(pmremTexture(source,environmentRotation.mul(equirectDirection(uv().flipY())),0).rgb.mul(environmentIntensity),1);
      environmentQuad=new THREE.QuadMesh(material); environmentSource=source;
    }
    environmentRotation.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(scene.environmentRotation).transpose());
    environmentIntensity.value=scene.environmentIntensity;
    renderer.setRenderTarget(environmentTarget); environmentQuad.render(renderer);
    environmentKey=key; environmentGeneration++;
  }

  function render({advance=true}={}) {
    if (disposed) throw Error('Local liquid host disposed');
    if (failure) throw Error(failure);
    const previousTarget=renderer.getRenderTarget(), previousOverride=scene.overrideMaterial, previousBackground=scene.background;
    const previousRenderObject=renderer.getRenderObjectFunction();
    const clearColor=renderer.getClearColor(new THREE.Color()), clearAlpha=renderer.getClearAlpha();
    try {
      const size=renderer.getDrawingBufferSize(new THREE.Vector2()), width=size.x, height=size.y;
      for (const target of [colorTarget,depthTarget,outputTarget]) target.setSize(width,height);
      renderer.initRenderTarget(outputTarget);
      const plan=localLiquidPresentationPlan(presentationMode);
      // Proxy presentation may refresh the sim every Nth frame (opt-in, default
      // every frame): the step is the solver's own fixed 1/60, so fewer steps
      // slow the water rather than coarsening it.
      const stepThisFrame = presentationMode!=='proxy' || proxyStepEvery <= 1 || frameCount % proxyStepEvery === 0;
      if (advance && !paused && stepThisFrame) solver.step(1/60);
      if (plan.environment) renderEnvironment();
      // The host color attachment is linear HDR even if another consumer
      // replaced the scene graph since the preceding water frame.
      if(pipeline.outputColorTransform){pipeline.outputColorTransform=false;pipeline.needsUpdate=true;}
      renderer.setRenderTarget(colorTarget); pipeline.render();
      // The retained liquid pass overlays/discards; every destination pixel
      // must begin with this frame's host image, including no-water pixels.
      renderer.copyTextureToTexture(colorTarget.texture,outputTarget.texture);
      if (!plan.liquidComposite) {
        // Proxy presentation: the scene render above already drew any proxy
        // layer; present it without the depth render or liquid composite.
        renderer.setRenderTarget(previousTarget); presentation.render();
        frameCount++;
        lastFrame={frameId:`local-liquid-${frameCount}`,width,height,presentation:presentationMode,route:ROUTE,submittedByHost:true,presentedByHost:true,
          displayTransform:'host-render-pipeline',simulationTimePolicy:proxyStepEvery>1?`one-fixed-1/60-step-every-${proxyStepEvery}-rendered-frames`:'one-fixed-1/60-step-per-rendered-frame',simulationRewind:false};
        return;
      }
      scene.overrideMaterial=depthMaterial; scene.background=null;
      renderer.setRenderObjectFunction((...args)=>{
        depthMaterial.side=args[4].side; renderer.renderObject(...args);
      });
      renderer.setClearColor(new THREE.Color(camera.far,0,0),1);
      renderer.setRenderTarget(depthTarget); renderer.render(scene,camera);
      scene.overrideMaterial=previousOverride; scene.background=previousBackground;
      renderer.setRenderObjectFunction(previousRenderObject);
      renderer.setClearColor(clearColor,clearAlpha);
      const generation=frameCount+1, frameId=`local-liquid-${generation}`;
      const cameraSnapshot=cameraFrame(camera,width,height,generation);
      const attachment=(id,target,extra)=>({authority:'host_live_frame',attachmentId:id,frameId,
        cameraIdentity:cameraSnapshot.identity,cameraGeneration:generation,deviceIdentity:PIPELINE,
        width:target.width,height:target.height,view:nativeTexture(target).createView(),...extra});
      const commandEncoder=device.createCommandEncoder({label:frameId});
      const hostFrame={schema:FRAME_SCHEMA,frameId,device,deviceIdentity:PIPELINE,commandEncoder,width,height,
        camera:cameraSnapshot,pipelineIdentity:PIPELINE,remapGeneration:0,supportIdentity:SUPPORT,
        route:{requested:ROUTE,effective:ROUTE,fallback:null},
        sceneColor:attachment('host-color',colorTarget,{format:'rgba16float',colorSpace:'linear_hdr'}),
        sceneDepth:attachment('host-depth',depthTarget,{format:'r32float',encoding:'linear_view_depth_meters'}),
        environment:attachment('host-environment',environmentTarget,{format:'rgba16float',mapping:'equirectangular_world_radiance'}),
        target:attachment('host-liquid-output',outputTarget,{format:'rgba16float',colorSpace:'linear_hdr'})};
      solver.render({hostFrame,externalCamera:cameraSnapshot});
      device.queue.submit([commandEncoder.finish()]);
      renderer.setRenderTarget(previousTarget); presentation.render();
      frameCount=generation;
      lastFrame={frameId,cameraIdentity:cameraSnapshot.identity,cameraGeneration:generation,width,height,presentation:'full',
        environmentSource:environmentSource.uuid,environmentGeneration,
        route:ROUTE,submittedByHost:true,presentedByHost:true,displayTransform:'host-render-pipeline',
        simulationTimePolicy:'one-fixed-1/60-step-per-rendered-frame',simulationRewind:false};
    } catch(error) { failure=error.message || String(error); throw error; }
    finally {
      scene.overrideMaterial=previousOverride; scene.background=previousBackground;
      renderer.setRenderObjectFunction(previousRenderObject);
      renderer.setClearColor(clearColor,clearAlpha); renderer.setRenderTarget(previousTarget);
    }
  }

  return {group,render,
    async readSceneColor({x,y,width,height}) {
      if(!frameCount||failure)throw Error(failure||'Water has no current scene-color frame');
      const frameId=lastFrame.frameId;
      const pixels=await renderer.readRenderTargetPixelsAsync(colorTarget,x,y,width,height);
      const nativeBytesPerRow=Math.ceil(width*8/256)*256;
      const expectedBytes=(height-1)*nativeBytesPerRow+width*8;
      if(!(pixels instanceof Uint16Array)||pixels.byteLength!==expectedBytes)throw Error('Scene-color native RGBA16 layout changed');
      const nativeValues=Array.from(pixels,THREE.DataUtils.fromHalfFloat),values=[];
      for(let row=0;row<height;row++)for(let channel=0;channel<width*4;channel++)values.push(nativeValues[row*nativeBytesPerRow/2+channel]);
      return {frameId,encoding:'linear_hdr',format:'rgba16float',width,height,
        nativeType:pixels.constructor.name,nativeBytesPerRow,nativeValues,values};
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
    // Full is the retained refraction composite; Proxy skips the liquid passes
    // so a proxy layer in the scene stands in for the water.
    setPresentation(mode){localLiquidPresentationPlan(mode);presentationMode=mode;return presentationMode;},
    get presentation(){return presentationMode;},
    setProxyStepEvery(n){if(!Number.isInteger(n)||n<1)throw Error('Proxy step interval must be a positive integer');proxyStepEvery=n;return proxyStepEvery;},
    get proxyStepEvery(){return proxyStepEvery;},
    interfaceRecordDescriptor:()=>(disposed||failure?null:solver.getInterfaceRecordDescriptor()),
    get paused(){return paused;},
    state:()=>({requestedRoute:ROUTE,effectiveRoute:frameCount && !failure ? ROUTE : null,registered:true,mounted:true,
      frameCount,paused,presentation:presentationMode,failure,setup:structuredClone(authored),supportGeometryVisible:group.visible,sourceGeneration,
      linearSceneColorInput:pipeline.outputColorTransform===false,lastFrame,solver:solver.getDebugState()}),
    dispose() {
      disposed=true;device.removeEventListener('uncapturederror',onGpuError); solver.destroy(); scene.remove(group);
      const materials=new Set(); group.traverse(child=>{child.geometry?.dispose();if(child.material)materials.add(child.material);});
      for(const material of materials)material.dispose();
      for(const target of [colorTarget,depthTarget,outputTarget,environmentTarget])target?.dispose();
      depthMaterial.dispose(); environmentQuad?.material.dispose(); presentation.dispose();
      releaseOutputTransform();
    }};
}
