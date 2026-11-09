import {neumipDefinition,checkedNeumipParameters} from './neumip-settings.mjs';
import {loadNeumipModel} from './neumip-model.mjs';
import {createNeumipMaterial} from './neumip-material.mjs';
// Decoded source is shared by recipe users and retained for history. GPU
// textures/program instances keep the ordinary slot lifetime and disposal.
const models=new Map();
const sourceKey=p=>JSON.stringify([p.source.url,p.source.sha256]);
export async function prepareNeumipParameters(parameters){
 const p=checkedNeumipParameters(parameters),key=sourceKey(p);let pending=models.get(key);
 if(!pending){pending=loadNeumipModel(p.source.url,{sha256:p.source.sha256}).then(model=>{models.set(key,model);return model;}).catch(error=>{models.delete(key);throw error;});models.set(key,pending);}
 await pending;
}
export const neumipProgram={...neumipDefinition,resourceKey:sourceKey,
 async defaults(){
  const root='/api/read?root=image-inbox&path=neumip-author-models%2F';
  const response=await fetch(root+'catalog.json');if(!response.ok)throw Error('Install NeuMIP author models first');
  const catalog=await response.json();if(catalog.schema!=='kaminos.neumip.author-models.v1'||!catalog.materials.wool2)throw Error('Invalid NeuMIP catalog');
  return {source:{url:root+encodeURIComponent(catalog.materials.wool2.filename),sha256:catalog.materials.wool2.sha256},uvScale:3,gain:1};
 },
 prepare:prepareNeumipParameters,
 create({parameters,slot}){
  if(!slot?.mesh?.geometry?.getAttribute('uv'))throw Error('Neural surface requires UV coordinates on the assigned mesh');
  const model=models.get(sourceKey(parameters));if(!model||model.then)throw Error('Prepare the neural checkpoint before assigning its material');
  const runtime=createNeumipMaterial(model,parameters);
  return {material:runtime.material,update:p=>{runtime.settings.scale.value=p.uvScale;runtime.settings.gain.value=p.gain;},dispose:()=>runtime.material.dispose()};
 }};
