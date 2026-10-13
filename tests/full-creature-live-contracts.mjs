// kaminos-test: node
import assert from 'node:assert/strict';
import {validateLiveManifest} from '../hindquarter-live-core.mjs';
const names=['pelvis','head','forelimb-left-shoulder'],vertices=3,triangles=1,channels=['fixed',...names],assets={};
for(const [name,shape,dtype]of [['rest.bin',[vertices,3],'<f4'],['triangles.bin',[triangles,3],'<u4'],
  ['automatic-weights.bin',[vertices,channels.length],'<f4'],['automatic-presets.bin',[2,vertices,3],'<f4']]){
  assets[name]={shape,dtype,bytes:shape.reduce((a,b)=>a*b,4),sha256:'b'.repeat(64)};
}
const m={schema:'kaminos.live-transport.v3',status:'completed',sourceSha256:'a'.repeat(64),sourceCast:'given-cast',candidatePaintedWeights:false,
  vertices,triangles,channels,assets,bones:names.map(name=>({name,parent:name==='pelvis'?null:'pelvis'})),presets:[{name:'rest'},{name:'head'}],
  reference:{kind:'none',reason:'No full-body painted reference'},provenance:{packageSha256:'c'.repeat(64),rigSourceSha256:'d'.repeat(64),frameChainSha256:'e'.repeat(64)}};
validateLiveManifest(m);
assert.throws(()=>validateLiveManifest({...m,channels:['fixed',...names.slice(1)]}),/inventory/);
assert.throws(()=>validateLiveManifest({...m,bones:m.bones.map(b=>({...b,parent:'missing'}))}),/hierarchy/);
assert.throws(()=>validateLiveManifest({...m,reference:{kind:'painted'}}),/reference/);
console.log('Given whole-tree manifest, source frame and absent full paint contract pass');
