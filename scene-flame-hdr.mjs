import * as THREE from './lib/three.webgpu.js';
import {createSceneEmissiveCamera} from './scene-emissive-camera.mjs';
const {texture,vec4,uniform,screenUV,getViewPosition,outputStruct,property,Fn,agxToneMapping,vec3,float}=THREE.TSL;

// Retain the native flame's linear transport through the ordinary mesh camera.
// The existing raymarch runs once. Its radiance composites into beauty and the
// emission attachment before bloom and one final camera transform.
export function createSceneFlameHDR({renderer,camera,device,bloom,decorate=x=>x}){
 const options={type:THREE.HalfFloatType,depthBuffer:false,generateMipmaps:false};
 const color=new THREE.RenderTarget(1,1,options),aux=new THREE.RenderTarget(1,1,{...options,count:2});
 color.texture.name='Physical flame and scene radiance';
 aux.textures[0].name='Physical mesh and flame emission';aux.textures[1].name='Opaque linear view depth';
 const zero=device.createTexture({label:'No water interface',size:[1,1],format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 device.queue.writeTexture({texture:zero},new Float32Array([0]),{bytesPerRow:4},[1,1]);
 const base=new THREE.RenderPipeline(renderer);base.outputColorTransform=false;
 const copyMaterial=new THREE.NodeMaterial(),copyQuad=new THREE.QuadMesh(copyMaterial);
 const display=new THREE.RenderPipeline(renderer),colorNode=texture(color.texture),emissionNode=texture(aux.textures[0]);
 let raw=null,emission=null,depth=null,bloomEffective=null,view=null,disposed=false,lastFrame=null;
 const native=target=>renderer.backend.get(target).texture;
 return {
  render({frame,input,emissionInput,depthInput,matched,physical}){
   if(disposed)throw Error('Scene flame HDR disposed');
   if(frame?.device!==device||frame.camera!==camera)throw Error('Scene flame HDR needs the current shared device and camera');
   if(!input||!emissionInput||!depthInput)throw Error('Scene flame HDR needs current radiance, emission and depth');
   const previous=renderer.getRenderTarget(),size=renderer.getDrawingBufferSize(new THREE.Vector2());
   color.setSize(size.x,size.y);aux.setSize(size.x,size.y);
   if(raw!==input){raw=input;base.outputNode=input;base.needsUpdate=true;}
   if(emission!==emissionInput||depth!==depthInput){
    emission=emissionInput;depth=depthInput;
    const e=property('vec4'),z=property('vec4');
    copyMaterial.colorNode=Fn(()=>{
     const d=depthInput.sample(screenUV).r.toVar();
     const viewZ=getViewPosition(screenUV,d,uniform(camera.projectionMatrixInverse)).z.negate();
     e.assign(vec4(emissionInput.sample(screenUV).rgb,1));
     z.assign(vec4(d.lessThan(1).select(viewZ,float(camera.far)),0,0,1));
     return vec4(0);
    })();copyMaterial.outputNode=outputStruct(e,z);copyMaterial.needsUpdate=true;
   }
   try{
    renderer.setRenderTarget(color);base.render();
    renderer.setRenderTarget(aux);copyQuad.render(renderer);
    const encoder=device.createCommandEncoder({label:'Physical scene flame HDR composition'});
    const receipt=frame.encode({encoder,targetView:native(color.texture).createView(),emissionTargetView:native(aux.textures[0]).createView(),
      frontDepthView:zero.createView(),sceneDepthView:native(aux.textures[1]).createView(),foreground:false});
    device.queue.submit([encoder.finish()]);
    const bloomSettings=bloom.read().settings,effective=bloomSettings.enabled&&bloomSettings.radius>0&&bloomSettings.strength>0;
    if(bloomEffective!==effective){
     bloomEffective=effective;
     const illuminated=bloom.output(colorNode,emissionNode);
     view={raw:decorate(illuminated),camera:createSceneEmissiveCamera(illuminated,{TSL:{uniform,vec3,vec4,float,Fn,agxToneMapping},THREE})};
     view.matched=decorate(view.camera.outputNode);
    }
    const cameraState=view.camera.update(matched,physical);
    const output=cameraState.effective?view.matched:view.raw;
    if(display.outputNode!==output||display.outputColorTransform===cameraState.effective){display.outputNode=output;display.outputColorTransform=!cameraState.effective;display.needsUpdate=true;}
    renderer.setRenderTarget(previous);display.render();
    lastFrame={identity:'scene-physical-emission-hdr-v1',effective:true,width:size.x,height:size.y,sourceFrame:frame.sourceFrame,sourceStep:frame.sourceStep,
      native:receipt,raymarches:1,bloomSignal:'physical-emission',cameraTransforms:1,camera:cameraState,physicalCalibration:physical?.physics??null};
    return lastFrame;
   }finally{renderer.setRenderTarget(previous);}
  },
  read:()=>lastFrame??{identity:'scene-physical-emission-hdr-v1',effective:false,reason:'awaiting-native-frame'},
  dispose(){if(disposed)return;disposed=true;for(const target of [color,aux])target.dispose();zero.destroy();copyMaterial.dispose();base.dispose();display.dispose();},
 };
}
