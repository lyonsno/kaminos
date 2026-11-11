import {projectFireSettingsToSchema} from './scene-fire-domain.mjs';
import {readAuthoredVolumeRuntimeControls} from './volume-runtime-control-values.mjs';
import {validateVolumeSettingsPresetDocument} from './volume-settings-preset-contract.mjs';
import {DEFAULT_VOLUME_SCENE} from './volume-scene-ontology.mjs';
import {GRID_TUNING_FIELDS} from './volume-grid-tuning.mjs';
import {resolveWorldCalibration,resolveSimulationLevers,readWorldCalibrationControls} from './volume-world-calibration.mjs';

const numericGridControls=new Set(GRID_TUNING_FIELDS.map(([,id])=>id).filter(id=>!['volume-world-smoke','volume-world-smoke-intermediate'].includes(id)));
const retiredPatterns=new Set(['concentric','spiral']);
const bool=value=>value===true||value==='true'||value==='1'||value===1;

// The worker build reads these definitions from the actual page markup. Only
// controls outside the persistence inventory may use their page defaults.
export function prepareSceneWorkerFireSettings(saved,{schema,definitions,mappingOptions,volumeSceneRequested=DEFAULT_VOLUME_SCENE}={}){
 if(!definitions||!mappingOptions)throw Error('Worker fire settings require actual control definitions and mapping options');
 const settings=projectFireSettingsToSchema(saved,schema),clamps=[];
 const persisted=new Set([...schema.controls,...schema.rendererControls??[],...schema.presentationControls??[]].map(entry=>entry.key));
 const nonPersistentControls={};
 for(const [id,definition]of Object.entries(definitions))if(!persisted.has(id)){
  nonPersistentControls[id]={type:definition.type,value:definition.type==='checkbox'?definition.checked:definition.value};
 }
 for(const axis of ['domControls','rendererControls'])for(const [id,descriptor]of Object.entries(settings[axis])){
  const definition=definitions[id];if(!definition)throw Error('Missing actual page control definition '+id);
  const raw=descriptor.rawValue??descriptor.value;let value=raw;
  if(definition.type==='checkbox'){
   if(typeof raw!=='boolean'&&!['0','1','true','false'].includes(String(raw)))throw Error('Invalid '+id);
   value=bool(raw);
  }else if(['range','number'].includes(definition.type)){
   value=Number(raw);if(!Number.isFinite(value))throw Error('Nonfinite '+id);
   // The page widens emitter centre/radius controls, and range writes preserve
   // saved continuous precision. Number inputs retain their own runtime checks.
   if(definition.type==='range'){
    const widenCentre=/^volume-immersed-centre-[xyz]$/.test(id),widenRadius=id==='volume-immersed-radius';
    const min=widenCentre?-Infinity:definition.min===''?-Infinity:Number(definition.min);
    const max=widenCentre||widenRadius?Infinity:definition.max===''?Infinity:Number(definition.max);
    const held=Math.max(min,Math.min(max,value));
    if(held!==value)clamps.push({id,requested:value,applied:held});
    value=held;
   }
  }else if(definition.type==='select-one'){
   value=String(raw);
   const retired=id==='volume-emitter-aperture-pattern'&&retiredPatterns.has(value);
   const grid=numericGridControls.has(id)&&Number.isFinite(Number(value));
   if(!retired&&!grid&&!definition.options?.includes(value))throw Error(`Unsupported ${id}: ${value}`);
  }else if(definition.type==='color'){
   if(!/^#[0-9a-f]{6}$/i.test(String(raw)))throw Error('Invalid color '+id);
   value=String(raw).toLowerCase();
  }
  descriptor.value=value;if(Object.hasOwn(descriptor,'rawValue')||definition.type==='range')descriptor.rawValue=String(value);
 }
 const presentation=settings.presentationControls['raymarch-smoke-presentation']?.value;
 if(!['on','off'].includes(presentation))throw Error('Invalid smoke presentation');
 settings.volumeSceneRequested=volumeSceneRequested;
 const calibration=readWorldCalibrationControls(settings.domControls);resolveWorldCalibration(calibration);resolveSimulationLevers(calibration);
 const controls=readAuthoredVolumeRuntimeControls(settings,{...mappingOptions,nonPersistentControls});
 return {settings,controls,presentation,clamps};
}

// A pinned basin remains a source/migration dependency even when a modern
// document's fire records own every saved coefficient. Never replace those
// records with the current basin or publish an applied-scene marker here.
export function createSceneWorkerFireSettingsLoader({definitions,mappingOptions,fetch:request=globalThis.fetch}={}){
 let schemaPromise=null;
 const schema=()=>schemaPromise??=(async()=>{
  const response=await request('/volume-settings-preset-schema-v2.json',{cache:'no-store'});
  if(!response.ok)throw Error('Fire settings schema lookup failed');return response.json();
 })().catch(error=>{schemaPromise=null;throw error;});
 return Object.freeze({async prepare(plan,context){
  context.assertCurrent();
  if(!plan.composition&&!plan.fireSettings)return null;
  const canonical=await schema();context.assertCurrent();
  let receipt=null;
  const presetId=plan.composition?.flame?.presetId;
  if(presetId){
   const response=await request(`/api/volume-settings-preset?id=${encodeURIComponent(presetId)}`,{cache:'no-store',signal:context.signal});
   const artifact=await response.json();context.assertCurrent();
   if(!response.ok)throw Error(artifact.error||'Basin lookup failed');
   receipt=validateVolumeSettingsPresetDocument(artifact,presetId,canonical);
   if(receipt.preset.domControls['emitter-assay-family']?.value==='cluster')throw Error('Cluster basins have no placeable flame source; use Workbench for that route');
  }
  const saved=plan.fireSettings??receipt?.preset;if(!saved)throw Error('Saved fire composition has no basin or authored fire settings');
  const options=typeof mappingOptions==='function'?mappingOptions(plan):mappingOptions;
  const prepared=prepareSceneWorkerFireSettings(saved,{schema:canonical,definitions,mappingOptions:options,
   volumeSceneRequested:receipt?.serverProjection?.sceneMigration?.requested??DEFAULT_VOLUME_SCENE});
  context.assertCurrent();return {...prepared,source:receipt};
 }});
}
