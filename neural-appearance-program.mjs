import {loadNeuralAppearanceBundle} from './neural-appearance-bundle.mjs';
import {createNeuralAppearanceMaterial} from './neural-appearance-material.mjs';
import {neuralAppearanceDefinition,checkedNeuralAppearanceParameters} from './neural-appearance-settings.mjs';
const bundles=new Map(),key=p=>JSON.stringify([p.source.url,p.source.sha256]);
export const neuralAppearanceProgram={...neuralAppearanceDefinition,resourceKey:key,
 async sources(){
  const root='/api/read?root=image-inbox&path=nvidia-appearance-models%2F';
  const response=await fetch(root+'catalog.json');if(!response.ok)throw Error('Install trained NVIDIA appearance models first');
  const catalog=await response.json();if(catalog.schema!=='kaminos.neural-appearance.catalog.v1'||!catalog.materials||Array.isArray(catalog.materials))throw Error('Invalid NVIDIA appearance catalogue');
  return Object.entries(catalog.materials).map(([label,entry])=>({label,source:checkedNeuralAppearanceParameters({source:{url:root+encodeURIComponent(entry.filename),sha256:entry.sha256}}).source}));
 },
 async defaults(){const [entry]=await this.sources();if(!entry)throw Error('No trained NVIDIA appearance checkpoints installed');return {source:entry.source,uvScale:1,gain:1};},
 async prepare(raw){const p=checkedNeuralAppearanceParameters(raw),k=key(p);if(!bundles.has(k))bundles.set(k,loadNeuralAppearanceBundle(p.source.url,p.source).then(value=>{bundles.set(k,value);return value;}).catch(e=>{bundles.delete(k);throw e;}));await bundles.get(k);},
 create({parameters,slot}){
  if(!slot?.mesh?.geometry?.getAttribute('uv'))throw Error('NVIDIA appearance requires surface UV coordinates');
  const bundle=bundles.get(key(parameters));if(!bundle||typeof bundle.then==='function')throw Error('Prepare the NVIDIA checkpoint before assignment');
  const runtime=createNeuralAppearanceMaterial(bundle,parameters);
  return {material:runtime.material,update:p=>{runtime.settings.scale.value=p.uvScale;runtime.settings.gain.value=p.gain;},dispose:runtime.dispose};
 }};
