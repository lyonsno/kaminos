import {MeshStandardNodeMaterial,PhysicalLightingModel,DataTexture,RGBAFormat,
 HalfFloatType,LinearFilter,DataUtils,NoColorSpace,TSL} from './lib/three.webgpu.js';
import {WOOD_FIBER_WGSL} from './wood-fiber-wgsl.mjs';
const {wgslFn,texture,uniform,normalView,tangentView,bitangentView,positionViewDirection,uv,vec2}=TSL;
const dielectric=wgslFn(WOOD_FIBER_WGSL.slice(0,WOOD_FIBER_WGSL.indexOf('fn woodFiberLobe')));
const lobe=wgslFn(WOOD_FIBER_WGSL.slice(WOOD_FIBER_WGSL.indexOf('fn woodFiberLobe')),[dielectric]);

export async function loadWoodMaps(manifestUrl,sample='cmaple'){
 const response=await fetch(manifestUrl);if(!response.ok)throw Error('Wood manifest unavailable');
 const manifest=await response.json();const descriptors=manifest.samples?.[sample];
 if(manifest.encoding!=='rgba32float-le'||!descriptors)throw Error('Unsupported measured wood sample');
 const maps={};
 try{
  for(const [name,d] of Object.entries(descriptors)){
   const r=await fetch(new URL(d.url,location.href));if(!r.ok)throw Error('Missing wood map '+name);
   const bytes=await r.arrayBuffer();if(bytes.byteLength!==d.width*d.height*16)throw Error('Wood map shape mismatch');
   const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(actual!==d.sha256)throw Error('Wood map hash mismatch');
   const values=new Float32Array(bytes),half=new Uint16Array(values.length);
   for(let i=0;i<values.length;i++)half[i]=DataUtils.toHalfFloat(values[i]);
   const t=new DataTexture(half,d.width,d.height,RGBAFormat,HalfFloatType);
   t.colorSpace=NoColorSpace;t.minFilter=LinearFilter;t.magFilter=LinearFilter;
   t.generateMipmaps=false;t.needsUpdate=true;maps[name]=t;
  }
  return {maps,source:{manifestUrl,sourceUrl:manifest.sourceUrl,sample,descriptors,model:'Marschner2005 fiber + host GGX surface'},dispose(){Object.values(maps).forEach(t=>t.dispose());}};
 }catch(e){Object.values(maps).forEach(t=>t.dispose());throw e;}
}

export function createWoodMaterial(maps,{fiberStrength=1,roughness=.28,ior=1.5}={}){
 if(!Number.isFinite(fiberStrength)||fiberStrength<0||!Number.isFinite(roughness)||roughness<=0||roughness>1||!Number.isFinite(ior)||ior<1)throw Error('Invalid wood material parameters');
 const strength=uniform(fiberStrength),index=uniform(ior);
 // Select the central measured patch, avoiding the acquisition border and
 // registration marks. Every channel uses the identical window; files remain intact.
 const coordinates=uv().mul(vec2(.36,.36)).add(vec2(.32,.32));
 const axisSample=texture(maps.axis,coordinates).rgb.mul(2).sub(1);
 // Author maps express the second axis opposite the cross(N,T) basis.
 const axis=tangentView.mul(axisSample.x).sub(bitangentView.mul(axisSample.y))
  .add(normalView.mul(axisSample.z)).normalize();
 const fiber=texture(maps.fiber,coordinates).rgb.mul(20);
 const beta=texture(maps.beta,coordinates).r;
 class WoodLighting extends PhysicalLightingModel{
  direct(data,builder){
   super.direct(data,builder);
   const value=lobe({n:normalView,a:axis,v:positionViewDirection,
    l:data.lightDirection,beta,eta:index});
   data.reflectedLight.directSpecular.addAssign(data.lightColor.mul(fiber).mul(value).mul(strength));
  }
 }
 const material=new MeshStandardNodeMaterial({roughness,metalness:0});
 material.colorNode=texture(maps.diffuse,coordinates).rgb;
 material.setupLightingModel=()=>new WoodLighting();
 return {material,setFiberStrength(value){if(!Number.isFinite(value)||value<0)throw Error('Fiber strength must be nonnegative');strength.value=value;},
  setRoughness(value){if(!Number.isFinite(value)||value<=0||value>1)throw Error('Roughness must be in (0,1]');material.roughness=value;},
  dispose(){material.dispose();}};
}
