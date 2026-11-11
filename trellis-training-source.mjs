import {createRawTrellisTrainingSource} from './trellis-raw-training-source.mjs';
// First native trainer source admits the already-observed finished plate's
// single static identity-transformed primitive, UV0 and embedded PNG PBR maps.
import {parseGlb,readTrianglePrimitives} from './poly-glb-io.mjs';
import {decodePNGBytes} from './lod-mesh-bake.mjs';
import {traceSupportRays} from './trellis-support-rays.mjs';
import {prepareSupportVolume,worldPoint} from './trellis-local-support.mjs';
import {clipSupportVolume} from './trellis-support-gpu.mjs';
import {sourceRegionTriangles,createTrellisTeacherSurface,SOURCE_TEACHER_UNIT_MATERIAL} from './trellis-surface-teacher.mjs';
import {SurfaceMaterialTeacher} from './surface-material-teacher.mjs';
const IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
export function materialFrameVector(v,frame,{point=false}={}){
 const d=v.map((x,k)=>x-(point?frame.origin[k]:0));return [dot(d,frame.u),dot(d,frame.n),-dot(d,frame.v)];
}
export async function createTrellisTrainingSource(device,bytes,{region,tileSize,rawSource}){
 if(rawSource!==undefined)return createRawTrellisTrainingSource(device,rawSource,{region,tileSize});
 const {json,bin}=parseGlb(bytes),primitives=readTrianglePrimitives(bytes);
 if(json.extensionsUsed?.length||primitives.length!==1||json.skins?.length||json.animations?.length)throw Error('First trainer source requires one static extension-free glTF primitive');
 const p=primitives[0],primitive=json.meshes[p.mesh].primitives[p.primitive];
 if(p.nodes.length!==1||p.worldMatrices[0].some((v,i)=>v!==IDENTITY[i])||!p.indices||!p.normals||!p.uvs||primitive.targets||Object.keys(primitive.attributes).some(k=>!['POSITION','NORMAL','TEXCOORD_0'].includes(k)))throw Error('First trainer source requires identity-transformed indexed position, normal and UV0');
 const mat=json.materials[p.material],pbr=mat?.pbrMetallicRoughness;
 if(!pbr||(mat.alphaMode??'OPAQUE')!=='OPAQUE'||mat.normalTexture||mat.occlusionTexture||mat.emissiveTexture||mat.emissiveFactor?.some(v=>v!==0)||mat.extensions||pbr.baseColorFactor?.[3]!==undefined&&pbr.baseColorFactor[3]!==1)throw Error('First trainer source requires opaque standard PBR without additional channels');
 if(!Number.isFinite(tileSize)||tileSize<=0||tileSize>2*region.radius)throw Error('Material tile must fit inside the source support');
 const textures=[],samplers=new Map(),cache=new Map();let surface,teacher;
 const address=new Map([[10497,'repeat'],[33071,'clamp-to-edge'],[33648,'mirror-repeat']]);
 const map=async(info,srgb)=>{
  if(info&&(info.texCoord??0)!==0||info?.extensions)throw Error('Only untransformed UV0 texture lookup supported in the first native source');
  const t=info?json.textures?.[info.index]:null;
  if(info&&!t)throw Error('Missing source texture');
  const key=`${info?.index??'white'}:${srgb}`;if(cache.has(key))return cache.get(key);
  const settings=t?json.samplers?.[t.sampler]??{}:{};
  if(!address.has(settings.wrapS??10497)||!address.has(settings.wrapT??10497)||![9728,9729].includes(settings.magFilter??9729)||![9728,9729,9984,9985,9986,9987].includes(settings.minFilter??9987))throw Error('Unsupported source texture sampler');
  let image={width:1,height:1,rgba:new Uint8Array([255,255,255,255])};
  if(t){const im=json.images?.[t.source],view=json.bufferViews?.[im?.bufferView];if(im?.mimeType!=='image/png'||!view||view.buffer!==0)throw Error('Embedded PNG source required');image=await decodePNGBytes(bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength));}
  const texture=device.createTexture({label:'Original native TRELLIS source texture',size:[image.width,image.height],format:srgb?'rgba8unorm-srgb':'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});textures.push(texture);
  device.queue.writeTexture({texture},image.rgba,{bytesPerRow:image.width*4},[image.width,image.height]);
  const desc={addressModeU:address.get(settings.wrapS??10497),addressModeV:address.get(settings.wrapT??10497),magFilter:(settings.magFilter??9729)===9728?'nearest':'linear',minFilter:[9728,9984,9986].includes(settings.minFilter??9987)?'nearest':'linear'},skey=JSON.stringify(desc);
  if(!samplers.has(skey))samplers.set(skey,device.createSampler(desc));
  const value={texture,sampler:samplers.get(skey),transform:[1,0,0,0,1,0,0,0,1]};cache.set(key,value);return value;
 };
 try{
  const prepared=prepareSupportVolume(p,region),candidate={...prepared,...await clipSupportVolume(device,prepared)};
  const triangles=sourceRegionTriangles(p,candidate),f=candidate.frame;
  // Proper rotation: (u,n,-v) is right handed, preserving winding and normals.
  const rotate=(v,point=false)=>materialFrameVector(v,f,{point});
  for(const t of triangles){for(const k of ['a','b','c'])t[k]=rotate(t[k],true);if(t.sourceNormals)t.sourceNormals=t.sourceNormals.map(v=>rotate(v));}
  const binding={color:pbr.baseColorFactor??[1,1,1,1],roughness:pbr.roughnessFactor??1,metalness:pbr.metallicFactor??1,base:await map(pbr.baseColorTexture,true),rough:await map(pbr.metallicRoughnessTexture,false),metal:await map(pbr.metallicRoughnessTexture,false)};
  surface=createTrellisTeacherSurface(device,{binding,side:mat.doubleSided?2:0});teacher=new SurfaceMaterialTeacher(device,{triangles,materials:[SOURCE_TEACHER_UNIT_MATERIAL],surface,environment:0,bounces:1});
  const referenceHeight=candidate.hi[2]*f.radius;
  const planeQuery={origin:worldPoint([0,0,candidate.hi[2]],f),direction:f.n.map(v=>-v)};
  const planeProbe=(await traceSupportRays(device,candidate,[planeQuery],{twoSided:mat.doubleSided===true})).samples[0];
  if(!planeProbe.hit)throw Error('Panel control requires a visible center surface to define its material sampling plane');
  const samplingPlaneHeight=rotate(planeProbe.position,true)[1];
  if(!Number.isFinite(samplingPlaneHeight)||samplingPlaneHeight>referenceHeight)throw Error('Material sampling plane is outside its source support');
  return {teacher,binding,triangles,capture:{tileSize,referenceHeight,samplingPlaneHeight},source:{region,tileSize,sourceTriangles:p.indices.length/3,clippedTriangles:triangles.length,sourceMaterial:p.material,side:mat.doubleSided?2:0,coordinateFrame:f,canonicalBasis:['u','n','-v'],samplingPlaneHeight,referenceHeight,samplingPlaneSelection:{method:'first visible center hit; independent of underside tessellation',query:planeQuery,probe:planeProbe},scope:'clipped source only; no exterior geometry, fixed material state, RGB directional response, no coverage/exit continuation'},
   dispose(){teacher.dispose();surface.dispose();for(const t of textures)t.destroy();}};
 }catch(e){teacher?.dispose();surface?.dispose();for(const t of textures)t.destroy();throw e;}
}
