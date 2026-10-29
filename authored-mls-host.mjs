import * as THREE from './lib/three.webgpu.js';
import {texture,vec4,positionView} from './lib/three.tsl.js';
import {createFluidSceneEnvironment} from './fluid-scene-environment.mjs';
import {createLocalLiquidScenePasses} from './local-liquid-scene-passes.mjs';
import {createMlsJuiceSolver} from './mls-juice-solver.mjs';
import {createMlsJuiceRenderer} from './mls-juice-renderer.mjs';
import {createMlsWaterProxy} from './mls-water-proxy.mjs';
import {MLS_ROUTE,MLS_SOURCE} from './mls-juice-contract.mjs';
import {localLiquidPresentationPlan} from './local-liquid-presentation.mjs';
export async function createAuthoredMlsHost({renderer,scene,camera,pipeline,device,setup={},emitters=[],initial,makePacket,readColliders=()=>[],isCurrent=()=>true,decorateOutput=x=>x,redraw=()=>{},getDisplayPolicy}){
 if(!device||renderer.backend.device!==device)throw Error('Authored MLS requires the actual shared WebGPU device');
 let solver,surface,proxy;
 try{
  solver=await createMlsJuiceSolver({device,setup:initial.solver,packet:makePacket(emitters),initialParticles:initial.initialParticles,sceneColliders:readColliders()});
  surface=await createMlsJuiceRenderer({device,solver,hostEnvironment:true});proxy=await createMlsWaterProxy(device,solver);
 }catch(error){proxy?.dispose();surface?.dispose();solver?.dispose();throw error;}
 if(!isCurrent()){proxy.dispose();surface.dispose();solver.dispose();return null;}
 const options={type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter};
 const environment=createFluidSceneEnvironment({renderer,scene,options});
 const color=new THREE.RenderTarget(1,1,options),output=new THREE.RenderTarget(1,1,options);
 const depth=new THREE.RenderTarget(1,1,{type:THREE.FloatType,format:THREE.RedFormat,depthBuffer:true,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
 const depthMaterial=new THREE.NodeMaterial();depthMaterial.fragmentNode=vec4(positionView.z.negate(),0,0,1);depthMaterial.blending=THREE.NoBlending;depthMaterial.toneMapped=false;
 const scenePasses=createLocalLiquidScenePasses({renderer,composedOutput:texture(output.texture),getDisplayPolicy,decorateOutput});
 let frameCount=0,paused=false,disposed=false,failure=null,lastFrame=null,mode='full',sourceGeneration=1,records=structuredClone(emitters),pendingSetup=structuredClone(setup),proxyStepEvery=1;
 const gpuError=event=>{failure=event.error?.message??'MLS GPU error';};device.addEventListener('uncapturederror',gpuError);
 device.lost.then(info=>{if(!disposed)failure=info.message||'MLS device lost';});
 const native=target=>renderer.backend.get(target.texture).texture.createView();
 function publishInlets(){solver.setPacket(makePacket(records,Date.now(),sourceGeneration));}
 const state=()=>({requestedRoute:MLS_ROUTE,effectiveRoute:frameCount&&!failure?MLS_ROUTE:null,source:MLS_SOURCE,registered:true,mounted:!disposed,mode:initial.mode,sourceIds:[...new Set([...initial.sourceIds,...records.filter(r=>r.localLiquidEmitter.mode!=='finite_drop').map(r=>r.id)])],sourceGeneration,
  frameCount,paused,presentation:mode,failure,lastFrame,clock:{...solver.read().clock,paused},setup:structuredClone(pendingSetup),solver:{...solver.read(),stepCount:solver.read().clock.step},surface:surface.read(),
  pendingSourceChanges:JSON.stringify(records.filter(r=>r.localLiquidEmitter.mode==='finite_drop').map(({id,type,transform,localLiquidEmitter})=>({id,type,transform,localLiquidEmitter})))!==JSON.stringify(initial.sourceRecords.filter(r=>r.localLiquidEmitter.mode==='finite_drop'))||JSON.stringify(setup)!==JSON.stringify(pendingSetup),
  ...scenePasses.state(),...environment.state(),fallbackRoute:null});
 return {supportsVolumeTransport:true,get paused(){return paused;},get presentation(){return mode;},get proxyStepEvery(){return proxyStepEvery;},
  setPresentation(value){localLiquidPresentationPlan(value);mode=value;return mode;},
  setProxyStepEvery(value){if(!Number.isSafeInteger(value)||value<1)throw Error('Proxy step interval must be a positive integer');proxyStepEvery=value;return value;},
  setPaused(value){paused=Boolean(value);solver.setPaused(paused);return paused;},
  setEmitters(next){makePacket(next);records=structuredClone(next);sourceGeneration++;publishInlets();return true;},
  setSetup(next){pendingSetup=structuredClone(next);},
  interfaceRecordDescriptor:()=>disposed?null:proxy.descriptor(),
  snapshot:()=>solver.snapshot(),
  async advanceTo(step){paused=true;publishInlets();const result=await solver.advanceTo(step);redraw();return result;},
  async readSceneColor({x,y,width,height}){
   if(!frameCount||failure||mode!=='full')throw Error(failure||'Water has no current full scene-color frame');
   const frameId=frameCount,pixels=await renderer.readRenderTargetPixelsAsync(color,x,y,width,height),nativeBytesPerRow=Math.ceil(width*8/256)*256;
   if(!(pixels instanceof Uint16Array)||pixels.byteLength!==(height-1)*nativeBytesPerRow+width*8)throw Error('Scene-color native RGBA16 layout changed');
   const nativeValues=Array.from(pixels,THREE.DataUtils.fromHalfFloat),values=[];
   for(let row=0;row<height;row++)for(let c=0;c<width*4;c++)values.push(nativeValues[row*nativeBytesPerRow/2+c]);
   return {frameId,encoding:'linear_hdr',format:'rgba16float',width,height,nativeType:pixels.constructor.name,nativeBytesPerRow,nativeValues,values};
  },
  async requestParticleState(){const step=solver.read().clock.step,words=await solver.snapshot();return {schema:'kaminos.mls-particle-state.v1',route:MLS_ROUTE,stepCount:step,particleCount:solver.config.capacity,recordFloats:20,coordinateSpace:'grid',originWorld:[...solver.config.min],cellSize:solver.config.cell,words:Array.from(words)};},
  render({advance=true,volumeTransport=null}={}){
   if(disposed||failure)throw Error(failure||'MLS host disposed');
   const target=renderer.getRenderTarget(),override=scene.overrideMaterial,background=scene.background,renderObject=renderer.getRenderObjectFunction(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
   try{
    solver.setSceneColliders(readColliders());publishInlets();if(advance&&(mode==='full'||frameCount%proxyStepEvery===0))solver.advance();
    const size=renderer.getDrawingBufferSize(new THREE.Vector2());for(const t of [color,output,depth])t.setSize(size.x,size.y);renderer.initRenderTarget(output);
    if(mode==='full')environment.render();
    scenePasses.update();renderer.setRenderTarget(color);scenePasses.capture.render();
    if(mode!=='full'){
     renderer.copyTextureToTexture(color.texture,output.texture);renderer.setRenderTarget(target);scenePasses.presentation.render();
     frameCount++;lastFrame={frameCount,presentation:mode,route:MLS_ROUTE,displayTransform:scenePasses.state().camera.transform};return;
    }
    scene.overrideMaterial=depthMaterial;scene.background=null;
    renderer.setRenderObjectFunction((...args)=>{if(args[4].depthWrite===false)return;for(let o=args[0];o;o=o.parent)if(o.userData?.kaminosEditorHelper||o.userData?.kaminosEditorOnly)return;depthMaterial.side=args[4].side;renderer.renderObject(...args);});
    renderer.setClearColor(new THREE.Color(camera.far,0,0),1);renderer.setRenderTarget(depth);renderer.render(scene,camera);
    scene.overrideMaterial=override;scene.background=background;renderer.setRenderObjectFunction(renderObject);renderer.setClearColor(clear,alpha);
    const encoder=device.createCommandEncoder({label:'Authored MLS shared frame'}),colorView=native(color),depthView=native(depth),outputView=native(output);
    const transport=[];
    surface.encode({encoder,hostCamera:camera,environment:environment.view(),sceneColor:colorView,sceneDepth:depthView,target:outputView,width:size.x,height:size.y,
     beforeComposite:({frontDepthView})=>{if(volumeTransport)transport.push(volumeTransport.encode({encoder,targetView:colorView,frontDepthView,sceneDepthView:depthView,foreground:false}));},
     afterComposite:({frontDepthView})=>{if(volumeTransport)transport.push(volumeTransport.encode({encoder,targetView:outputView,frontDepthView,sceneDepthView:depthView,foreground:true}));}});
    device.queue.submit([encoder.finish()]);renderer.setRenderTarget(target);scenePasses.presentation.render();frameCount++;
    lastFrame={frameCount,width:size.x,height:size.y,route:MLS_ROUTE,camera:camera.uuid,sharedDevice:true,presentation:mode,volumeTransport:volumeTransport?transport:null};
   }catch(error){failure=String(error);throw error;}
   finally{scene.overrideMaterial=override;scene.background=background;renderer.setRenderObjectFunction(renderObject);renderer.setClearColor(clear,alpha);renderer.setRenderTarget(target);}
  },state,
  dispose(){if(disposed)return;disposed=true;device.removeEventListener('uncapturederror',gpuError);proxy.dispose();surface.dispose();solver.dispose();depthMaterial.dispose();for(const t of [color,output,depth])t.dispose();scenePasses.dispose();environment.dispose();}
 };
}
