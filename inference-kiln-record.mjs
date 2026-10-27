import {BufferGeometryLoader,Mesh,MeshStandardMaterial} from './lib/three.core.js';
export const PROMPT_RELIEF_SOURCE='kaminos:prompt-relief-v1';
const schema='kaminos.prompt-relief.v1';
export function checkedPromptRelief(value){
 if(value?.schema!==schema||typeof value.prompt!=='string'||!value.prompt.trim())throw Error('Invalid saved prompt relief');
 if(!['crust','incineration'].includes(value.appearance))throw Error('Invalid saved prompt appearance');
 const attributes=value.geometry?.data?.attributes,p=attributes?.position;
 if(p?.itemSize!==3||!Array.isArray(p.array)||!p.array.length||p.array.length%3||!p.array.every(Number.isFinite))throw Error('Saved prompt requires finite complete geometry');
 const constructors={Float32Array,Float64Array,Uint16Array,Uint32Array,Uint8Array,Int16Array,Int32Array,Int8Array};
 for(const attribute of Object.values(attributes))if(!constructors[attribute.type]||!Number.isSafeInteger(attribute.itemSize)||attribute.itemSize<1||attribute.array?.length/attribute.itemSize!==p.array.length/3||!attribute.array.every(Number.isFinite))throw Error('Invalid saved prompt attribute');
 const index=value.geometry.data.index;
 if(index&&(!['Uint16Array','Uint32Array'].includes(index.type)||!Array.isArray(index.array)||index.array.length%3||!index.array.every(i=>Number.isSafeInteger(i)&&i>=0&&i<p.array.length/3)))throw Error('Invalid saved prompt triangles');
 if(!index&&p.array.length%9)throw Error('Invalid saved prompt triangles');
 return structuredClone(value);
}
export function promptReliefRecord(object){
 const value=object?.userData?.kaminosPromptRelief;if(!value)return null;
 return {source:PROMPT_RELIEF_SOURCE,type:'pbr',promptRelief:checkedPromptRelief({...value,geometry:object.geometry.toJSON()})};
}
export function restorePromptRelief(record){
 const value=checkedPromptRelief(record.promptRelief),geometry=new BufferGeometryLoader().parse(value.geometry);
 const material=new MeshStandardMaterial({color:0xb8b2a8,roughness:.8,metalness:0});material.userData.kaminosBurnAppearance=value.appearance;
 const object=new Mesh(geometry,material);object.name='Prompt';object.castShadow=true;object.receiveShadow=true;
 const {geometry:_,...metadata}=value;object.userData.kaminosPromptRelief=metadata;return object;
}
export const promptReliefMetadata=(prompt,appearance)=>({schema,prompt,appearance});
