import {ROUTE} from './model.mjs';
// Offline evidence validation, excluded from the interactive experiment.
export function validateTerrainRead(value,expected={}){
 if(value?.route!==ROUTE||value.backend!=='webgpu'||value.initialized!==true||value.prepared!==true||value.readbackInRuntime!==false||value.error)throw Error('Incomplete or wrong Hill GPU route');
 for(const [key,wanted]of Object.entries(expected)){
  const actual=Object.hasOwn(value.config??{},key)?value.config[key]:value[key];
  if(actual!==wanted)throw Error(`Hill evidence ${key}: expected ${wanted}, got ${actual}`);
 }
 return value;
}
export function compareTerrainState(actual,expected,tolerance=2e-5){
 if(!actual?.length||actual.length!==expected.length||actual.length%4)throw Error('Complete matching terrain arrays required');
 let maxError=0,soil=0;
 for(let i=0;i<actual.length;i++){
  if(!Number.isFinite(actual[i])||!Number.isFinite(expected[i]))throw Error('Nonfinite terrain evidence');
  const error=Math.abs(actual[i]-expected[i]);maxError=Math.max(maxError,error);
  if(error>tolerance)throw Error(`Terrain mismatch at ${i}: ${actual[i]} vs ${expected[i]} (${error})`);
  if(i%4===1){if(actual[i]<0)throw Error('Negative loose material');soil+=actual[i];}
 }
 return{maxError,soil,values:actual.length,tolerance};
}

export function validateFormedRead(s,expected={}){
 if(!s||s.route!=='kaminos/hill/geological-formation-v1'||s.pending||s.error||!s.formation||s.runtimeReadback!==false)throw Error('Incomplete or invalid formed landscape');
 if(s.gpu?.backend!=='webgpu'||!s.gpu.initialized||s.gpu.error||s.gpu.provenance?.kind!=='formed-landscape')throw Error('Formed GPU route is not mounted');
 if(s.formation.steps!==s.formation.config.iterations||s.formation.version!==s.gpu.provenance.version)throw Error('Incomplete or stale formation');
 for(const [key,value]of Object.entries({...s.config,...expected}))if(s.config[key]!==value||s.formation.config[key]!==value||s.gpu.provenance.recipe[key]!==value)throw Error('Effective formation recipe mismatch: '+key);
 return s;
}
