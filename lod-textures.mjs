// Appearance products for an immutable mesh/UV layout. Reuses the ordinary GLB
// store and loader; image bytes change, geometry accessors and placement do not.
import {parseGlb, encodeGlb, readAccessor} from './poly-glb-io.mjs';
import {encodeTrellisTexturePNG} from './models/trellis2/trellis-material.js';
import {decodePNGBytes, readGLBLocalSurfaceAndMaterials} from './lod-mesh-bake.mjs';
import {addNormalMapToGLB} from './lod-normal-bake.mjs';

export const TEXTURE_SET_SCHEMA='kaminos.lod-textures.v1';
export const digestBytes=async input=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',input))].map(v=>v.toString(16).padStart(2,'0')).join('');
const imageBytes=({json,bin},index)=>{const image=json.images[index],v=json.bufferViews[image.bufferView];
  if(image.mimeType!=='image/png')throw Error('LOD appearance currently requires embedded PNG images');
  return bin.slice(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);};
export function textureInfo(input){
  const doc=parseGlb(input);let gpuBytes=0;const images=doc.json.images??[];
  const dimensions=images.map((_,i)=>{const bytes=imageBytes(doc,i),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(bytes.length<24||v.getUint32(0)!==0x89504e47)throw Error('LOD appearance image is not PNG');
    const width=v.getUint32(16),height=v.getUint32(20);let w=width,h=height;
    if(!w||!h)throw Error('LOD appearance image has empty dimensions');
    for(;;){gpuBytes+=4*w*h;if(w===1&&h===1)break;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}
    return [width,height];});
  return {dimensions,textureSize:Math.max(0,...dimensions.flat()),gpuBytes};
}
export async function geometrySignature(input){
  const {json,bin}=parseGlb(input);
  const structure={scene:json.scene,scenes:json.scenes,nodes:json.nodes,meshes:json.meshes,skins:json.skins,animations:json.animations,
    accessors:(json.accessors??[]).map((a,i)=>({type:a.type,componentType:a.componentType,normalized:a.normalized??false,count:a.count,data:[...readAccessor(json,bin,i)]}))};
  return digestBytes(new TextEncoder().encode(JSON.stringify(structure)));
}
function replaceImages(input,images,metadata){
  const {json,bin}=parseGlb(input),oldImages=new Set((json.images??[]).map(i=>i.bufferView));
  const chunks=[],views=[];let length=0;
  const append=(bytes,extra={})=>{const start=(length+3)&~3;chunks.push([start,bytes]);length=start+bytes.length;return {...extra,buffer:0,byteOffset:start,byteLength:bytes.length};};
  for(let i=0;i<json.bufferViews.length;i++){
    const view=json.bufferViews[i];
    views.push(oldImages.has(i)?null:append(bin.slice(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),view));
  }
  images.forEach((bytes,i)=>{views[json.images[i].bufferView]=append(bytes);});
  if(views.some(v=>!v))throw Error('Incomplete LOD image replacement');
  json.bufferViews=views;json.buffers=[{byteLength:(length+3)&~3}];
  json.extras={...json.extras,lodAppearance:metadata};
  const out=new Uint8Array(json.buffers[0].byteLength);for(const [offset,bytes]of chunks)out.set(bytes,offset);
  return encodeGlb(json,out).buffer;
}
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const srgb=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
function resize(image,width,height,{color=false,normal=false}={}){
  const out=new Uint8Array(width*height*4),src=image.rgba;
  // Area filtering, including non-power-of-two sources. Normal maps average
  // vectors and renormalize; base color filters in linear light.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const x0=x*image.width/width,x1=(x+1)*image.width/width,y0=y*image.height/height,y1=(y+1)*image.height/height,sums=[0,0,0,0];let weight=0;
    for(let sy=Math.floor(y0);sy<Math.ceil(y1);sy++)for(let sx=Math.floor(x0);sx<Math.ceil(x1);sx++){
      const w=(Math.min(x1,sx+1)-Math.max(x0,sx))*(Math.min(y1,sy+1)-Math.max(y0,sy)),i=(sy*image.width+sx)*4;weight+=w;
      for(let c=0;c<4;c++){let v=src[i+c]/255;if(c<3)v=normal?v*2-1:color?linear(v):v;sums[c]+=w*v;}
    }
    for(let c=0;c<4;c++)sums[c]/=weight;
    if(normal){const n=Math.hypot(...sums.slice(0,3));for(let c=0;c<3;c++)sums[c]=n?sums[c]/n:(c===2?1:0);}
    for(let c=0;c<4;c++){let v=sums[c];if(c<3)v=normal?v*.5+.5:color?srgb(v):v;out[(y*width+x)*4+c]=Math.max(0,Math.min(255,Math.round(v*255)));}
  }
  return out;
}
export function sourceTextureSizes(glb,{minimum=256}={}){
  const max=textureInfo(glb).textureSize;if(!max)return [];
  const sizes=[max];while(sizes.at(-1)>minimum)sizes.push(Math.max(minimum,Math.floor(sizes.at(-1)/2)));
  return sizes;
}
export async function buildTextureVariants({baseGLB,sizes,bakeMaterial=null,normalOptions=null,relativeTexelSize=null,source=null,onPhase=()=>{}}){
  if(!sizes?.length||!sizes.every(n=>Number.isSafeInteger(n)&&n>0)||new Set(sizes).size!==sizes.length)throw Error('Distinct positive texture sizes required');
  const max=Math.max(...sizes),doc=parseGlb(baseGLB),signature=await geometrySignature(baseGLB);
  let normalBake=null;
  let images=doc.json.images.map((_,i)=>imageBytes(doc,i));
  const colorImages=new Set(),normalImages=new Set();
  for(const mat of doc.json.materials??[]){
    const texImage=info=>info?doc.json.textures?.[info.index]?.source:null;
    const color=texImage(mat.pbrMetallicRoughness?.baseColorTexture),normal=texImage(mat.normalTexture);
    if(color!=null)colorImages.add(color);if(normal!=null)normalImages.add(normal);
  }
  if(bakeMaterial){
    onPhase('bake-appearance');const surface=await readGLBLocalSurfaceAndMaterials(baseGLB);
    const maps=await bakeMaterial({...surface,textureSize:max});
    if(doc.json.materials?.length!==1)throw Error('Rebaking LOD appearance requires one baked material');
    const mat=doc.json.materials[0];
    for(const [binding,pixels]of [[mat.pbrMetallicRoughness?.baseColorTexture,maps.baseColor],[mat.pbrMetallicRoughness?.metallicRoughnessTexture,maps.metallicRoughness]]){
      if(!binding)throw Error('LOD material is missing a baked texture binding');
      images[doc.json.textures[binding.index].source]=new Uint8Array(await encodeTrellisTexturePNG({pixels,width:max,height:max}));
    }
  }
  if(normalOptions&&normalImages.size){
    onPhase('bake-appearance-normals');
    // The normal baker adds tangents once. A temporary bake input omits the
    // existing binding, then verifies that its computed basis is identical;
    // the appearance product retains the original accessors byte for byte.
    const normalJSON=structuredClone(doc.json);
    for(const material of normalJSON.materials??[])delete material.normalTexture;
    for(const mesh of normalJSON.meshes)for(const primitive of mesh.primitives)delete primitive.attributes.TANGENT;
    const normalGLB=await addNormalMapToGLB(encodeGlb(normalJSON,doc.bin).buffer,{...normalOptions,textureSize:max}),normalDoc=parseGlb(normalGLB);
    for(let m=0;m<doc.json.meshes.length;m++)for(let p=0;p<doc.json.meshes[m].primitives.length;p++){
      const original=doc.json.meshes[m].primitives[p].attributes.TANGENT;
      if(original!==undefined){
        const a=readAccessor(doc.json,doc.bin,original),b=readAccessor(normalDoc.json,normalDoc.bin,normalDoc.json.meshes[m].primitives[p].attributes.TANGENT);
        if(a.length!==b.length||a.some((v,i)=>v!==b[i]))throw Error('Rebaked normals require a different tangent basis');
      }
    }
    normalBake=normalDoc.json.extras.lodNormalMap;
    const index=normalDoc.json.textures[normalDoc.json.materials[0].normalTexture.index].source;
    images[[...normalImages][0]]=imageBytes(normalDoc,index);
  }
  const decoded=[];for(const bytes of images)decoded.push(await decodePNGBytes(bytes));
  const originalSize=textureInfo(baseGLB).textureSize;
  const variants=[];
  for(const size of [...sizes].sort((a,b)=>b-a)){
    onPhase('encode-appearance');const resized=[];
    for(let i=0;i<images.length;i++){
      const image=decoded[i],scale=size/Math.max(...decoded.map(im=>Math.max(im.width,im.height)));
      const w=Math.max(1,Math.round(image.width*scale)),h=Math.max(1,Math.round(image.height*scale));
      resized.push(w===image.width&&h===image.height?images[i]:new Uint8Array(await encodeTrellisTexturePNG({pixels:resize(image,w,h,{color:colorImages.has(i),normal:normalImages.has(i)}),width:w,height:h})));
    }
    const glb=replaceImages(baseGLB,resized,{schema:TEXTURE_SET_SCHEMA,source,textureSize:size,geometrySignature:signature,...(normalBake?{normalBake}:{})});
    if(await geometrySignature(glb)!==signature)throw Error('Appearance changed mesh geometry or UVs');
    const info=textureInfo(glb);
    variants.push({glb,sha256:await digestBytes(glb),textureSize:info.textureSize,gpuBytes:info.gpuBytes,
      relativeTexelSize:relativeTexelSize>0?relativeTexelSize*originalSize/size:1/size});
  }
  return variants;
}
export async function publishTextureVariants({source,geometry,variants,server='',fetch=globalThis.fetch}){
  const metadata=[];
  for(const {glb,...variant}of variants){
    const response=await fetch(`${server}/api/ingest-mesh?role=lod-tier`,{method:'POST',body:new Uint8Array(glb)}),receipt=await response.json();
    if(!response.ok||receipt.sha256!==variant.sha256)throw Error('Appearance ingest did not confirm content identity');
    metadata.push(variant);
  }
  const response=await fetch(`${server}/api/mesh-lod-textures`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,geometry,variants:metadata})}),receipt=await response.json();
  if(!response.ok||receipt.source!==source||receipt.geometry!==geometry||!metadata.every(v=>receipt.textureSet?.variants?.some(actual=>actual.sha256===v.sha256&&actual.textureSize===v.textureSize&&actual.gpuBytes===v.gpuBytes&&actual.relativeTexelSize===v.relativeTexelSize)))throw Error(`Appearance registration failed: ${JSON.stringify(receipt)}`);
  return receipt.textureSet;
}
