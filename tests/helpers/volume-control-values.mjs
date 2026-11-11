import {readFileSync} from 'node:fs';
import {readVolumeRuntimeControlValues} from '../../volume-runtime-control-values.mjs';
const original=JSON.parse(readFileSync(new URL('../fixtures/volume-runtime-controls/page-b99.json',import.meta.url),'utf8'))[0];
// Actual mapper over preserved pre-extraction page inputs. Tests can vary the
// coefficients under discussion without creating an alternate control mapper.
export function mapVolumeControlValues(patch={},options={}){
 const controls=structuredClone(original.controls);
 for(const [id,value]of Object.entries(patch))controls[id]={...controls[id],...(typeof value==='object'?value:typeof value==='boolean'?{checked:value}:{value})};
 return readVolumeRuntimeControlValues({route:original.route,quality:'full',...options,readControl:id=>{
  const control=controls[id];if(!control)throw Error('Unexpected test control '+id);
  return {...control,requestedValue:id==='volume-scene'?control.dataset?.volumeSceneRequest:control.dataset?.volumeRetiredPatternRequest};
 }});
}
