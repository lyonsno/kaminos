import {MeshStandardNodeMaterial,DataArrayTexture,DataUtils,RGBAFormat,HalfFloatType,LinearFilter,RepeatWrapping,NoColorSpace,DoubleSide} from './lib/three.webgpu.js';
import {Fn,uniform,texture,uv,positionViewDirection,TBNViewMatrix,normalView,vec3,float,sqrt,max} from './lib/three.tsl.js';
import {evaluateFilteredSurface} from './filtered-surface-lod.mjs';

export function validateFilteredSurfaceModel(value){
 if(value?.schema!=='kaminos.filtered-surface-moments.v1'||value.terms!==16||![value.width,value.height].every(n=>Number.isSafeInteger(n)&&n>0)||!value.coefficients||value.coefficients.length!==value.width*value.height*48||!Array.from(value.coefficients).every(Number.isFinite)||!Number.isFinite(value.footprint)||value.footprint<=0)throw Error('Invalid filtered directional response model');
 return {...value,coefficients:Float32Array.from(value.coefficients)};
}
export async function loadFilteredSurfaceModel(url,{sha256,signal}={}){
 const response=await fetch(url,{signal});if(!response.ok)throw Error(`Filtered material fetch ${response.status}`);const bytes=await response.arrayBuffer();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 if(sha256&&sha256!==hash)throw Error('Filtered material digest mismatch');
 return {...validateFilteredSurfaceModel(JSON.parse(new TextDecoder().decode(bytes))),artifact:{url:response.url,sha256:hash,bytes:bytes.byteLength}};
}
export function createFilteredSurfaceMaterial(input,{uvScale=1,gain=1}={}){
 const model=validateFilteredSurfaceModel(input),data=new Uint16Array(model.width*model.height*16*4);
 for(let p=0;p<model.width*model.height;p++)for(let term=0;term<16;term++)for(let c=0;c<3;c++){
  const v=model.coefficients[(p*16+term)*3+c];if(Math.abs(v)>65504)throw Error('Coefficient exceeds float16 capacity; no clipping performed');
  data[(term*model.width*model.height+p)*4+c]=DataUtils.toHalfFloat(v);
 }
 const field=new DataArrayTexture(data,model.width,model.height,16);field.type=HalfFloatType;field.format=RGBAFormat;field.colorSpace=NoColorSpace;field.magFilter=field.minFilter=LinearFilter;field.wrapS=field.wrapT=RepeatWrapping;field.generateMipmaps=false;field.needsUpdate=true;field.flipY=false;
 const scale=uniform(uvScale),brightness=uniform(gain),coords=uv().mul(scale),view=positionViewDirection.mul(TBNViewMatrix).negate().toVar('filteredView');
 const v=[float(1),view.x,view.y,sqrt(max(0,float(1).sub(view.xy.dot(view.xy))))];
 const coefficients=Array.from({length:16},(_,i)=>texture(field,coords).depth(i).rgb.toVar(`filteredCoefficient${i}`));
 // The spatial samples and contraction with view are shared across all lights.
 const responseColumns=Array.from({length:4},(_,j)=>Fn(()=>{let sum=vec3(0);for(let i=0;i<4;i++)sum=sum.add(coefficients[i*4+j].mul(v[i]));return sum;})().toVar(`filteredViewColumn${j}`));
 class FilteredMaterial extends MeshStandardNodeMaterial{
  setupLightingModel(builder){const lighting=super.setupLightingModel(builder);
   lighting.direct=({lightDirection,lightColor,reflectedLight})=>{const l=lightDirection.mul(TBNViewMatrix).negate(),basis=[float(1),l.x,l.y,sqrt(max(0,float(1).sub(l.xy.dot(l.xy))))];let response=vec3(0);for(let j=0;j<4;j++)response=response.add(responseColumns[j].mul(basis[j]));reflectedLight.directDiffuse.addAssign(response.max(0).mul(lightColor).mul(normalView.dot(lightDirection).max(0)).mul(brightness));};
   lighting.indirect=()=>{};lighting.directRectArea=()=>{throw Error('Filtered response area-light integration is not implemented');};return lighting;
  }
 }
 const material=new FilteredMaterial();material.name='Filtered directional response';material.side=DoubleSide;material.isMeshStandardNodeMaterial=false;
 material.userData.filteredSurface={source:input.artifact??null,footprint:model.footprint,model:'16 joint first-order angular terms',precision:'float32 fitted coefficients, float16 filtered runtime fields',lighting:'native direct lights; indirect not evaluated',cost:'16 spatial coefficient samples and view contraction shared per pixel; four RGB terms per light; GPU savings unmeasured'};
 material.addEventListener('dispose',()=>field.dispose());
 return {material,field,settings:{scale,gain:brightness},evaluate:(uv,direction)=>evaluateFilteredSurface(model,uv,direction),read:()=>({...material.userData.filteredSurface,uvScale:scale.value,gain:brightness.value})};
}
