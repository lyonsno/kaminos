import {loadNeuralAppearanceBundle} from './neural-appearance-bundle.mjs';
import {createNeuralAppearanceMaterial} from './neural-appearance-material.mjs';
import {neuralAppearanceDefinition,checkedNeuralAppearanceParameters} from './neural-appearance-settings.mjs';
const bundles=new Map(),key=p=>JSON.stringify(p.source);
export const neuralAppearanceProgram={...neuralAppearanceDefinition,resourceKey:key,
 async prepare(raw){const p=checkedNeuralAppearanceParameters(raw),k=key(p);if(!bundles.has(k))bundles.set(k,loadNeuralAppearanceBundle(p.source.url,p.source).then(value=>{bundles.set(k,value);return value;}).catch(e=>{bundles.delete(k);throw e;}));await bundles.get(k);},
 create({parameters,slot}){
  if(!slot?.mesh?.geometry?.getAttribute('uv'))throw Error('NVIDIA appearance requires surface UV coordinates');
  const bundle=bundles.get(key(parameters));if(!bundle||typeof bundle.then==='function')throw Error('Prepare the NVIDIA checkpoint before assignment');
  const runtime=createNeuralAppearanceMaterial(bundle,parameters);
  return {material:runtime.material,update:p=>{runtime.settings.scale.value=p.uvScale;runtime.settings.gain.value=p.gain;},dispose:runtime.dispose};
 }};
