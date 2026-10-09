import * as THREE from './lib/three.webgpu.js';
import {texture,vec4,positionView,pmremTexture,equirectDirection,uv,uniform} from './lib/three.tsl.js';
import {withLocalLiquidHelperGround} from './local-liquid-authoring.mjs';
import {withLocalLiquidDepthBackground,readLocalLiquidDepthFrame} from './local-liquid-depth-background.mjs';
import {resolveFingerFluidOpticalDebugMode,KAMINOS_FINGER_FLUID_LOCAL_HOST_FRAME_ROUTE as ROUTE,KAMINOS_FINGER_FLUID_LOCAL_HOST_FRAME_SCHEMA as FRAME_SCHEMA,KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE as SUPPORT} from './finger-fluid-webgpu-core.js';

export function resolveFluidViewportMode(params=new URLSearchParams()) {
  const mode=params.get('finger_fluid_viewport')??'shared';
  if(!['shared','producer'].includes(mode))throw new RangeError(`Unknown fluid viewport: ${mode}`);
  return mode;
}

export function fluidViewportCameraFrame(camera, width, height, generation) {
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

/** Scene capture and final presentation are shared; the caller owns solver lifetime. */
export function createFluidViewportHost({renderer,scene,camera,pipeline,device,solver,
  pipelineIdentity='kaminos/local-liquid-authoring-v0',framePrefix='local-liquid',group=null,helperGround=null}) {
  if(!device||renderer.backend.device!==device)throw Error('Fluid viewport requires the host WebGPU device');
  if(!solver?.available||typeof solver.render!=='function')throw Error('Fluid viewport requires an available solver');
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
  const originalOutputTransform=pipeline.outputColorTransform;
  pipeline.outputColorTransform=false; pipeline.needsUpdate=true;
  const environmentRotation=uniform(new THREE.Matrix3()), environmentIntensity=uniform(1);
  let environmentTarget=null, environmentQuad=null, environmentSource=null, environmentKey=null, environmentGeneration=0;
  let opticalDebugMode='shaded';
  let frameCount=0, paused=false, failure=null, lastFrame=null, lastDepthFrame=null, disposed=false;
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

  function render(options) {return withLocalLiquidHelperGround(helperGround,()=>renderFrame(options));}

  function renderFrame({advance=true,renderOptions={}}={}) {
    if (disposed) throw Error('Local liquid host disposed');
    if (failure) throw Error(failure);
    const previousTarget=renderer.getRenderTarget(), previousOverride=scene.overrideMaterial, previousBackground=scene.background;
    const previousRenderObject=renderer.getRenderObjectFunction();
    const clearColor=renderer.getClearColor(new THREE.Color()), clearAlpha=renderer.getClearAlpha();
    try {
      const size=renderer.getDrawingBufferSize(new THREE.Vector2()), width=size.x, height=size.y;
      for (const target of [colorTarget,depthTarget,outputTarget]) target.setSize(width,height);
      renderer.initRenderTarget(outputTarget);
      if (advance && !paused) solver.step(1/60);
      renderEnvironment();
      renderer.setRenderTarget(colorTarget); pipeline.render();
      // The retained liquid pass overlays/discards; every destination pixel
      // must begin with this frame's host image, including no-water pixels.
      renderer.copyTextureToTexture(colorTarget.texture,outputTarget.texture);
      scene.overrideMaterial=depthMaterial; scene.background=null;
      renderer.setRenderObjectFunction((...args)=>{
        depthMaterial.side=args[4].side; renderer.renderObject(...args);
      });
      const depthFrame={frameId:`${framePrefix}-${frameCount+1}`,cameraFar:camera.far,supportVisible:group?.visible??false};
      renderer.setClearColor(new THREE.Color(depthFrame.cameraFar,0,0),1);
      renderer.setRenderTarget(depthTarget); withLocalLiquidDepthBackground(scene,()=>renderer.render(scene,camera));
      lastDepthFrame=depthFrame;
      scene.overrideMaterial=previousOverride; scene.background=previousBackground;
      renderer.setRenderObjectFunction(previousRenderObject);
      renderer.setClearColor(clearColor,clearAlpha);
      const generation=frameCount+1, frameId=`${framePrefix}-${generation}`;
      const cameraSnapshot=fluidViewportCameraFrame(camera,width,height,generation);
      const attachment=(id,target,extra)=>({authority:'host_live_frame',attachmentId:id,frameId,
        cameraIdentity:cameraSnapshot.identity,cameraGeneration:generation,deviceIdentity:pipelineIdentity,
        width:target.width,height:target.height,view:nativeTexture(target).createView(),...extra});
      const commandEncoder=device.createCommandEncoder({label:frameId});
      const hostFrame={schema:FRAME_SCHEMA,frameId,device,deviceIdentity:pipelineIdentity,commandEncoder,width,height,
        camera:cameraSnapshot,pipelineIdentity,remapGeneration:0,supportIdentity:SUPPORT,
        route:{requested:ROUTE,effective:ROUTE,fallback:null},
        sceneColor:attachment('host-color',colorTarget,{format:'rgba16float',colorSpace:'linear_hdr'}),
        sceneDepth:attachment('host-depth',depthTarget,{format:'r32float',encoding:'linear_view_depth_meters'}),
        environment:attachment('host-environment',environmentTarget,{format:'rgba16float',mapping:'equirectangular_world_radiance'}),
        target:attachment('host-liquid-output',outputTarget,{format:'rgba16float',colorSpace:'linear_hdr'})};
      solver.render({...renderOptions,hostFrame,externalCamera:cameraSnapshot,opticalDebugMode});
      device.queue.submit([commandEncoder.finish()]);
      renderer.setRenderTarget(previousTarget); presentation.render();
      frameCount=generation;
      lastFrame={frameId,cameraIdentity:cameraSnapshot.identity,cameraGeneration:generation,width,height,
        environmentSource:environmentSource.uuid,environmentGeneration,
        route:ROUTE,opticalDebugMode,submittedByHost:true,presentedByHost:true,displayTransform:'host-render-pipeline',exposure:renderer.toneMappingExposure,environmentIntensity:scene.environmentIntensity,
        simulationTimePolicy:'one-fixed-1/60-step-per-rendered-frame',simulationRewind:false,
        helperGroundPresentation:{policy:'retained-basin-suppresses-editor-helper',effectiveVisible:helperGround?.visible??null}};
    } catch(error) { failure=error.message || String(error); throw error; }
    finally {
      scene.overrideMaterial=previousOverride; scene.background=previousBackground;
      renderer.setRenderObjectFunction(previousRenderObject);
      renderer.setClearColor(clearColor,clearAlpha); renderer.setRenderTarget(previousTarget);
    }
  }

  return {render,
    setPaused(value){paused=Boolean(value);return paused;},
    get paused(){return paused;},
    state:()=>({frameCount,paused,failure,lastFrame}),
    setOpticalDebugForWitness(value){opticalDebugMode=resolveFingerFluidOpticalDebugMode(value);return opticalDebugMode;},
    async readBackgroundDepthForWitness(){
      if(disposed||failure)throw Error('Fluid viewport depth draw is unavailable');
      return readLocalLiquidDepthFrame(renderer,depthTarget,lastDepthFrame);
    },
    dispose(){
      disposed=true;device.removeEventListener('uncapturederror',onGpuError);
      for(const target of [colorTarget,depthTarget,outputTarget,environmentTarget])target?.dispose();
      depthMaterial.dispose();environmentQuad?.material.dispose();presentation.dispose();
      pipeline.outputColorTransform=originalOutputTransform;pipeline.needsUpdate=true;
    }
  };
}
