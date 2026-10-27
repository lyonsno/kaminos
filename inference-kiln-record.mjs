import {BufferGeometry,BufferGeometryLoader,Mesh,MeshStandardMaterial} from './lib/three.core.js';
export const PROMPT_RELIEF_SOURCE='kaminos:prompt-relief-v1';
export const promptReliefRecordDomain={type:'pbr',source:PROMPT_RELIEF_SOURCE,
 recognize:object=>Boolean(object?.userData?.kaminosPromptRelief),
 check:r=>({...r,promptRelief:checkedPromptRelief(r.promptRelief)}),fields:r=>({promptRelief:r.promptRelief}),
 capture:entry=>promptReliefRecord(entry.object)??{},
 reloadable:r=>{checkedPromptRelief(r.promptRelief);return true;},
 load:(r,loaders,options)=>loaders.constructed(restorePromptRelief(r),r,options)};
const schema='kaminos.prompt-relief.v1';
export function checkedPromptRelief(value){
 if(value?.schema!==schema||typeof value.prompt!=='string'||!value.prompt.trim())throw Error('Invalid saved prompt relief');
 if(!['crust','incineration'].includes(value.appearance))throw Error('Invalid saved prompt appearance');
 const attributes=value.geometry?.data?.attributes,p=attributes?.position;
 if(p?.itemSize!==3||!Array.isArray(p.array)||!p.array.length||p.array.length%3||!p.array.every(Number.isFinite))throw Error('Saved prompt requires finite complete geometry');
 // Prompt reliefs use ordinary Float32 vertex attributes. Validate the
 // decoder's effective representation, not just finite JSON numbers.
 for(const attribute of Object.values(attributes)){
  if(attribute.isInterleavedBufferAttribute||attribute.type!=='Float32Array'||!Number.isSafeInteger(attribute.itemSize)||attribute.itemSize<1||!Array.isArray(attribute.array)||attribute.array.length/attribute.itemSize!==p.array.length/3||!attribute.array.every(x=>Number.isFinite(x)&&Number.isFinite(Math.fround(x))))throw Error('Invalid saved prompt attribute representation');
 }
 if(value.geometry.data.morphAttributes&&Object.keys(value.geometry.data.morphAttributes).length)throw Error('Unsupported saved prompt attribute representation');
 const index=value.geometry.data.index,maximum=index?.type==='Uint16Array'?65535:4294967295;
 if(index!==undefined&&(!index||!['Uint16Array','Uint32Array'].includes(index.type)||!Array.isArray(index.array)||index.array.length%3||!index.array.every(i=>Number.isSafeInteger(i)&&i>=0&&i<p.array.length/3&&i<=maximum)))throw Error('Invalid saved prompt triangles');
 if(index===undefined&&p.array.length%9)throw Error('Invalid saved prompt triangles');
 // This source emits current groups only; the decoder's legacy fallbacks are unsupported.
 if(value.geometry.data.drawcalls!==undefined||value.geometry.data.offsets!==undefined)throw Error('Unsupported saved prompt triangle representation');
 const triangleVertices=index?.array.length??p.array.length/3;
 if(value.geometry.data.groups?.some(g=>!Number.isSafeInteger(g.start)||!Number.isSafeInteger(g.count)||g.start<0||g.count<0||g.start%3||g.count%3||g.start+g.count>triangleVertices||!Number.isSafeInteger(g.materialIndex)||g.materialIndex<0))throw Error('Invalid saved prompt triangles');
 const sphere=value.geometry.data.boundingSphere;
 if(sphere!==undefined&&(!sphere||!Array.isArray(sphere.center)||sphere.center.length!==3||!sphere.center.every(Number.isFinite)||!Number.isFinite(sphere.radius)||sphere.radius<0))throw Error('Invalid saved prompt geometry bounds');
 return structuredClone(value);
}
export function promptReliefRecord(object){
 const value=object?.userData?.kaminosPromptRelief;if(!value)return null;
 // Parametric geometry normally serializes a constructor recipe. Retain the
 // rendered buffers instead; reopening must not depend on fonts or shaping.
 const geometry=object.geometry.parameters?new BufferGeometry().copy(object.geometry):object.geometry;
 geometry.uuid=object.geometry.uuid;
 return {source:PROMPT_RELIEF_SOURCE,type:'pbr',promptRelief:checkedPromptRelief({...value,geometry:geometry.toJSON()})};
}
export function restorePromptRelief(record){
 const value=checkedPromptRelief(record.promptRelief),geometry=new BufferGeometryLoader().parse(value.geometry);
 const material=new MeshStandardMaterial({color:0xb8b2a8,roughness:.8,metalness:0});material.userData.kaminosBurnAppearance=value.appearance;
 const object=new Mesh(geometry,material);object.name='Prompt';object.castShadow=true;object.receiveShadow=true;
 const {geometry:_,...metadata}=value;object.userData.kaminosPromptRelief=metadata;return object;
}
export const promptReliefMetadata=(prompt,appearance)=>({schema,prompt,appearance});
