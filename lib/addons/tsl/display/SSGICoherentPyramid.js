import {StorageTexture,FloatType,HalfFloatType,RGBAFormat,NearestFilter,NearestMipmapNearestFilter,WebGPUCoordinateSystem} from 'three/webgpu';
import {createCoherentPyramidGPU} from './SSGICoherentPyramidGPU.js';

export default class SSGICoherentPyramid {
 constructor(camera){
  this.camera=camera;this.frames=0;this.width=this.height=1;
  this.textures=[0,1,2].map(i=>{const t=new StorageTexture(1,1);t.name=['SSGI coherent point','SSGI coherent radiance','SSGI coherent normal'][i];t.type=i===0?FloatType:HalfFloatType;t.format=RGBAFormat;t.minFilter=NearestMipmapNearestFilter;t.magFilter=NearestFilter;t.generateMipmaps=false;t.mipmapsAutoUpdate=false;t.mipmaps=[{}];return t;});
 }
 update(renderer,source,tolerance,normalCos){
  const {width,height}=source;const levels=Math.floor(Math.log2(Math.max(width,height)))+1;
  for(const t of this.textures){if(this.width!==width||this.height!==height){t.setSize(width,height);t.mipmaps=Array.from({length:levels},()=>({}));t.needsUpdate=true;}renderer.initTexture(t);}
  this.width=width;this.height=height;
  const device=renderer.backend.device;if(this.device!==device){this.gpu?.dispose();this.gpu=createCoherentPyramidGPU(device);this.device=device;}
  const matrix=this.camera.projectionMatrix.elements,webgpu=renderer.coordinateSystem===WebGPUCoordinateSystem;
  const values=new Float32Array([matrix[14],matrix[10],webgpu?1:2,webgpu?0:-1,this.camera.near,this.camera.far,tolerance,normalCos,renderer.logarithmicDepthBuffer?1:0,0,0,0]);
  this.gpu.run(source.textures.map(t=>renderer.backend.get(t).texture),this.textures.map(t=>renderer.backend.get(t).texture),values);this.frames++;
 }
 dispose(){this.gpu?.dispose();this.textures.forEach(t=>t.dispose());}
}
