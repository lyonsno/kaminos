import {createFluidFrameTiming} from './fluid-frame-timing.mjs';
import {createSceneEmissiveCamera} from './scene-emissive-camera.mjs';
import * as THREE from './lib/three.webgpu.js';
import {texture,vec4,positionView,pmremTexture,equirectDirection,uv,uniform,vec3,float} from './lib/three.tsl.js';
import {withLocalLiquidHelperGround} from './local-liquid-authoring.mjs';
import {withLocalLiquidDepthBackground,readLocalLiquidDepthFrame} from './local-liquid-depth-background.mjs';
import {resolveFingerFluidOpticalDebugMode,KAMINOS_FINGER_FLUID_LOCAL_HOST_FRAME_ROUTE as ROUTE,KAMINOS_FINGER_FLUID_LOCAL_HOST_FRAME_SCHEMA as FRAME_SCHEMA,KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE as SUPPORT} from './finger-fluid-webgpu-core.js';

export function resolveFluidViewportMode(params=new URLSearchParams()) {
  const mode=params.get('finger_fluid_viewport')??'shared';
  if(!['shared','producer'].includes(mode))throw new RangeError(`Unknown fluid viewport: ${mode}`);
  return mode;
}

export function resolveFluidViewportRenderer(params=new URLSearchParams()) {
  return params.get('finger_fluid_renderer') || (resolveFluidViewportMode(params)==='shared'?'screen_space_refraction':'screen_space_surface');
}

export function applyFluidViewportDisplayPolicy({pipeline,presentation,rawOutput,composedOutput,matchedOutput,effective}) {
  const output=pipeline.outputNode,transform=pipeline.outputColorTransform;
  pipeline.outputNode=rawOutput;pipeline.outputColorTransform=false;pipeline.needsUpdate=true;
  const finalOutput=effective?matchedOutput:composedOutput,finalTransform=!effective;
  if(presentation.outputNode!==finalOutput||presentation.outputColorTransform!==finalTransform){
    presentation.outputNode=finalOutput;presentation.outputColorTransform=finalTransform;presentation.needsUpdate=true;
  }
  return ()=>{pipeline.outputNode=output;pipeline.outputColorTransform=transform;pipeline.needsUpdate=true;};
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
  pipelineIdentity='kaminos/local-liquid-authoring-v0',framePrefix='local-liquid',group=null,helperGround=null,getDisplayPolicy=null}) {
  if(!device||renderer.backend.device!==device)throw Error('Fluid viewport requires the host WebGPU device');
  if(!solver?.available||typeof solver.render!=='function')throw Error('Fluid viewport requires an available solver');
  const targetOptions = {type:THREE.HalfFloatType, depthBuffer:false, minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter};
  const colorTarget = new THREE.RenderTarget(1,1,targetOptions);
  const outputTarget = new THREE.RenderTarget(1,1,targetOptions);
  const lowColorTarget=new THREE.RenderTarget(1,1,targetOptions);
  const lowWaterTarget=new THREE.RenderTarget(1,1,{...targetOptions,depthBuffer:true,depthTexture:new THREE.DepthTexture(1,1,THREE.UnsignedIntType)});
  const lowDepthTarget=new THREE.RenderTarget(1,1,{type:THREE.FloatType,format:THREE.RedFormat,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  const quad=fragment=>{const material=new THREE.NodeMaterial();material.toneMapped=false;material.fragmentNode=fragment;return new THREE.QuadMesh(material);};
  const downColor=quad(texture(colorTarget.texture));
  let downDepth;
  const depthTarget = new THREE.RenderTarget(1,1,{type:THREE.FloatType,format:THREE.RedFormat,depthBuffer:true,
    minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  downDepth=quad(vec4(texture(depthTarget.texture).r,0,0,1));
  const startLowWater=quad(vec4(texture(lowColorTarget.texture).rgb,0));
  const lowAlpha=texture(lowWaterTarget.texture).a.clamp(0,1);
  const depthProjection=uniform(new THREE.Vector4());
  const waterNdc=texture(lowWaterTarget.depthTexture).r;
  const waterViewDepth=depthProjection.y.sub(waterNdc.mul(depthProjection.w)).div(depthProjection.x.sub(waterNdc.mul(depthProjection.z)));
  const highSceneDepth=texture(depthTarget.texture).r;
  const resolvedWaterColor=texture(colorTarget.texture).rgb.mul(lowAlpha.oneMinus()).add(texture(lowWaterTarget.texture).rgb).sub(texture(lowColorTarget.texture).rgb.mul(lowAlpha.oneMinus()));
  const resolveWater=quad(vec4(highSceneDepth.greaterThan(0).and(highSceneDepth.lessThan(waterViewDepth.sub(.002))).select(texture(colorTarget.texture).rgb,resolvedWaterColor),1));
  const timing=createFluidFrameTiming(device);
  let renderScale=1;
  const setRenderScale=value=>{if(disposed)throw Error('Fluid viewport disposed');if(!Number.isFinite(value)||value<=0||value>1)throw Error('Water render scale must be above zero and at most 100%');renderScale=value;return renderScale;};
  colorTarget.texture.name='Local liquid host color'; outputTarget.texture.name='Local liquid composed color';
  depthTarget.texture.name='Local liquid host linear depth';
  const depthMaterial = new THREE.NodeMaterial(); depthMaterial.fragmentNode=vec4(positionView.z.negate(),0,0,1);
  depthMaterial.blending=THREE.NoBlending; depthMaterial.toneMapped=false; depthMaterial.side=THREE.DoubleSide;
  const composedOutput=texture(outputTarget.texture);
  const presentation = new THREE.RenderPipeline(renderer,composedOutput);
  const finalCamera=createSceneEmissiveCamera(composedOutput,{TSL:{uniform,vec3,vec4,float},THREE});
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

  function renderFrame({advance=true,renderOptions={},simulationState=null}={}) {
    if (disposed) throw Error('Local liquid host disposed');
    if (failure) throw Error(failure);
    const previousTarget=renderer.getRenderTarget(), previousOverride=scene.overrideMaterial, previousBackground=scene.background;
    const previousRenderObject=renderer.getRenderObjectFunction();
    const clearColor=renderer.getClearColor(new THREE.Color()), clearAlpha=renderer.getClearAlpha();
    let restoreDisplay=null;
    try {
      const policy=getDisplayPolicy?.()??{rawOutput:pipeline.outputNode,cameraState:{effective:false}};
      const cameraState=policy.cameraState??{effective:false};
      finalCamera.update(cameraState.effective,{...cameraState,effective:'emissive-transport-v2'});
      restoreDisplay=applyFluidViewportDisplayPolicy({pipeline,presentation,rawOutput:policy.rawOutput,composedOutput,matchedOutput:finalCamera.outputNode,effective:cameraState.effective});
      const size=renderer.getDrawingBufferSize(new THREE.Vector2()), width=size.x, height=size.y;
      for (const target of [colorTarget,depthTarget,outputTarget]) target.setSize(width,height);
      renderer.initRenderTarget(outputTarget);
      timing.begin();
      if (advance && !paused) timing.scope('simulation',()=>solver.step(1/60));
      timing.scope('host',()=>renderEnvironment());
      renderer.setRenderTarget(colorTarget); timing.scope('host',()=>pipeline.render());
      // The retained liquid pass overlays/discards; every destination pixel
      // must begin with this frame's host image, including no-water pixels.
      if(renderScale===1)renderer.copyTextureToTexture(colorTarget.texture,outputTarget.texture);
      scene.overrideMaterial=depthMaterial; scene.background=null;
      renderer.setRenderObjectFunction((...args)=>{
        depthMaterial.side=args[4].side; renderer.renderObject(...args);
      });
      const depthFrame={frameId:`${framePrefix}-${frameCount+1}`,cameraFar:camera.far,supportVisible:group?.visible??false};
      renderer.setClearColor(new THREE.Color(depthFrame.cameraFar,0,0),1);
      renderer.setRenderTarget(depthTarget); withLocalLiquidDepthBackground(scene,()=>timing.scope('host',()=>renderer.render(scene,camera)));
      lastDepthFrame=depthFrame;
      scene.overrideMaterial=previousOverride; scene.background=previousBackground;
      renderer.setRenderObjectFunction(previousRenderObject);
      renderer.setClearColor(clearColor,clearAlpha);
      const waterWidth=Math.max(1,Math.floor(width*renderScale)),waterHeight=Math.max(1,Math.floor(height*renderScale));
      const scaled=renderScale!==1;
      if(scaled){
        const p=camera.projectionMatrix.elements;depthProjection.value.set(p[10],p[14],p[11],p[15]);
        for(const target of [lowColorTarget,lowDepthTarget,lowWaterTarget])target.setSize(waterWidth,waterHeight);
        timing.scope('host',()=>{renderer.setRenderTarget(lowColorTarget);downColor.render(renderer);renderer.setRenderTarget(lowDepthTarget);downDepth.render(renderer);renderer.setRenderTarget(lowWaterTarget);startLowWater.render(renderer);});
      }
      const frameColor=scaled?lowColorTarget:colorTarget,frameDepth=scaled?lowDepthTarget:depthTarget,frameOutput=scaled?lowWaterTarget:outputTarget;
      const simulationPaused=simulationState?.paused??paused,simulationAdvanced=simulationState?.advanced??(advance&&!paused);
      const generation=frameCount+1, frameId=`${framePrefix}-${generation}`;
      const cameraSnapshot=fluidViewportCameraFrame(camera,waterWidth,waterHeight,generation);
      const attachment=(id,target,extra)=>({authority:'host_live_frame',attachmentId:id,frameId,
        cameraIdentity:cameraSnapshot.identity,cameraGeneration:generation,deviceIdentity:pipelineIdentity,
        width:target.width,height:target.height,view:nativeTexture(target).createView(),...extra});
      const commandEncoder=device.createCommandEncoder({label:frameId});
      const hostFrame={schema:FRAME_SCHEMA,frameId,device,deviceIdentity:pipelineIdentity,commandEncoder,width:waterWidth,height:waterHeight,
        camera:cameraSnapshot,pipelineIdentity,remapGeneration:0,supportIdentity:SUPPORT,
        route:{requested:ROUTE,effective:ROUTE,fallback:null},
        sceneColor:attachment('host-color',frameColor,{format:'rgba16float',colorSpace:'linear_hdr'}),
        sceneDepth:attachment('host-depth',frameDepth,{format:'r32float',encoding:'linear_view_depth_meters'}),
        environment:attachment('host-environment',environmentTarget,{format:'rgba16float',mapping:'equirectangular_world_radiance'}),
        target:attachment('host-liquid-output',frameOutput,{format:'rgba16float',colorSpace:'linear_hdr'}),
        ...(scaled?{compositeDepth:{...attachment('host-water-depth',lowWaterTarget,{format:'depth24plus',encoding:'webgpu_ndc_depth'}),view:nativeTexture({texture:lowWaterTarget.depthTexture}).createView()}}:{})};
      timing.scope('water',()=>solver.render({...renderOptions,hostFrame,externalCamera:cameraSnapshot,opticalDebugMode,suppressRayCounting:timing.active}));
      device.queue.submit([commandEncoder.finish()]);
      if(scaled)timing.scope('host',()=>{renderer.setRenderTarget(outputTarget);resolveWater.render(renderer);});
      renderer.setRenderTarget(previousTarget); timing.scope('host',()=>presentation.render());
      frameCount=generation;
      lastFrame={camera:cameraSnapshot,frameId,cameraIdentity:cameraSnapshot.identity,cameraGeneration:generation,width,height,
        environmentSource:environmentSource.uuid,environmentGeneration,
        waterResolution:{requestedScale:renderScale,width:waterWidth,height:waterHeight,fullWidth:width,fullHeight:height,pixelFraction:waterWidth*waterHeight/(width*height),resolve:scaled?'depth_tested_alpha_water_layer_over_full_resolution_scene':'native_full_resolution'},
        route:ROUTE,opticalDebugMode,submittedByHost:true,presentedByHost:true,captureColorSpace:'linear_hdr',displayTransform:cameraState.effective?cameraState.transform:'host-render-pipeline',exposure:renderer.toneMappingExposure,environmentIntensity:scene.environmentIntensity,
        simulationTimePolicy:advance?'one-fixed-1/60-step-per-rendered-frame':'caller-owned-step',simulationRewind:false,
        helperGroundPresentation:{policy:'retained-basin-suppresses-editor-helper',effectiveVisible:helperGround?.visible??null}};
      timing.finish({hostFrameId:frameId,step:solver.getFrameBudgetState().step,paused:simulationPaused,simulationAdvanced,waterResolution:lastFrame.waterResolution,reflection:solver.getReflectionBudgetControls().effective,energy:solver.getFrameBudgetState().energy.mode,camera:cameraSnapshot,environmentSource:environmentSource.uuid,environmentGeneration});
    } catch(error) { timing.abort(error);failure=error.message || String(error); throw error; }
    finally {
      restoreDisplay?.();
      scene.overrideMaterial=previousOverride; scene.background=previousBackground;
      renderer.setRenderObjectFunction(previousRenderObject);
      renderer.setClearColor(clearColor,clearAlpha); renderer.setRenderTarget(previousTarget);
    }
  }

  return {render,
    // Keep the fixture and its helper-ground policy while exercising the
    // ordinary scene graph alone. No water depth/capture/resolve is submitted.
    renderSceneOnly(){
      if(disposed||failure)throw Error(failure||'Fluid viewport disposed');
      return withLocalLiquidHelperGround(helperGround,()=>pipeline.render());
    },
    sceneSnapshot(){return withLocalLiquidHelperGround(helperGround,()=>{
      const objects=[];scene.updateMatrixWorld();
      scene.traverse(object=>objects.push({id:object.uuid,parent:object.parent?.uuid??null,
        visible:object.visible,type:object.type,world:object.matrixWorld.toArray(),
        geometry:object.geometry?{id:object.geometry.uuid,index:object.geometry.index?.count??null,
          attributes:Object.fromEntries(Object.entries(object.geometry.attributes).map(([key,a])=>[key,{count:a.count,version:a.version}]))}:null,
        material:Array.isArray(object.material)?object.material.map(m=>m.uuid):object.material?.uuid??null}));
      return objects;
    });},
    frameIdentity:()=>failure?null:lastFrame&&({frameId:lastFrame.frameId,route:lastFrame.route,waterResolution:{...lastFrame.waterResolution},camera:lastFrame.camera,opticalDebugMode:lastFrame.opticalDebugMode,environmentSource:lastFrame.environmentSource,environmentGeneration:lastFrame.environmentGeneration,exposure:lastFrame.exposure}),
    beginFrameTiming:timing.begin,
    stepSimulation:dt=>timing.scope('simulation',()=>solver.step(dt)),
    abortFrameTiming:timing.abort,
    setPaused(value){paused=Boolean(value);return paused;},
    get paused(){return paused;},
    state:()=>({frameCount,paused,failure,lastFrame,renderScale,timing:timing.read()}),
    setRenderScale,
    setTimingEnabled:timing.setEnabled,
    setOpticalDebugForWitness(value){opticalDebugMode=resolveFingerFluidOpticalDebugMode(value);return opticalDebugMode;},
    async readBackgroundDepthForWitness(){
      if(disposed||failure)throw Error('Fluid viewport depth draw is unavailable');
      return readLocalLiquidDepthFrame(renderer,depthTarget,lastDepthFrame);
    },
    dispose(){
      disposed=true;device.removeEventListener('uncapturederror',onGpuError);
      timing.destroy();for(const target of [colorTarget,depthTarget,outputTarget,environmentTarget,lowColorTarget,lowDepthTarget,lowWaterTarget])target?.dispose();
      for(const q of [downColor,downDepth,startLowWater,resolveWater]){q.material.dispose();}
      depthMaterial.dispose();environmentQuad?.material.dispose();presentation.dispose();

    }
  };
}
