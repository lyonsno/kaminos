// kaminos-test: node
import assert from 'node:assert/strict';
import {readNeuralAppearanceBundle,loadNeuralAppearanceBundle} from '../neural-appearance-bundle.mjs';
const layer=(i,o)=>({num_inputs:i,num_outputs:o,weights:Array(i*o).fill(0),biases:Array(o).fill(0)});
const source={latents:{num_channels:8},decoder:{hidden_layers:[16,16],hidden_activations:'SmeLU',output_activation:{type:'ScaledSigmoid',scale:1e5},half_diff_parameterization:'StableRusinkiewicz',num_shading_frames:2,direction_inputs:'WhWdZiZo',_params:{rotation:{rotation_decoder:{mlp_layers:[layer(8,12)]}},network:{mlp_layers:[layer(24,16),layer(16,16),layer(16,3)]}}},kaminos:{schema:'kaminos.neural-appearance.bundle.v1',response:'projected-bsdf',filtering:'nearest-authored-texel-mip',levels:[{width:2,height:2,url:'latents.f32',sha256:'a'.repeat(64)}],provenance:{kind:'portability-fixture'}}};
const bundle=readNeuralAppearanceBundle(source);
assert.equal(bundle.decoder.mac.shared+bundle.decoder.mac.directional,784);
assert.equal(bundle.levels[0].byteLength,2*2*8*4);
assert.equal(bundle.response,'projected-bsdf');
assert.throws(()=>readNeuralAppearanceBundle({...source,kaminos:undefined}),/spatial bundle/);
for(const field of ['response','filtering']){const bad=structuredClone(source);bad.kaminos[field]='unknown';assert.throws(()=>readNeuralAppearanceBundle(bad),new RegExp(field));}
const bad=structuredClone(source);bad.kaminos.levels[0].sha256='';assert.throws(()=>readNeuralAppearanceBundle(bad),/SHA256/);
const dimensions=structuredClone(source);dimensions.kaminos.levels[0].width=1.5;assert.throws(()=>readNeuralAppearanceBundle(dimensions),/dimension/);
const future=structuredClone(source);future.kaminos.additionalMetadata={optional:true};assert.equal(readNeuralAppearanceBundle(future).levels.length,1);
console.log('Neural appearance: exact response/filtering, decoder identity and spatial payload validation passed');
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const payload=new Float32Array(32).fill(.125),valid=structuredClone(source);valid.kaminos.levels[0].sha256=await hash(payload);
const bytes=new TextEncoder().encode(JSON.stringify(valid)),sha256=await hash(bytes);
let requests=[];const fetcher=async url=>{requests.push(String(url));return new Response(String(url).endsWith('model.json')?bytes:payload);};
const loaded=await loadNeuralAppearanceBundle('http://localhost/models/model.json',{sha256,fetcher});assert.equal(loaded.levels[0].data[31],.125);assert.deepEqual(requests,['http://localhost/models/model.json','http://localhost/models/latents.f32']);
await assert.rejects(loadNeuralAppearanceBundle('http://localhost/models/model.json',{sha256:'b'.repeat(64),fetcher}),/checkpoint digest/);
await assert.rejects(loadNeuralAppearanceBundle('http://localhost/models/model.json',{sha256,fetcher:async url=>new Response(String(url).endsWith('model.json')?bytes:new Float32Array(31))}),/byte count/);
await assert.rejects(loadNeuralAppearanceBundle('http://localhost/models/model.json',{sha256,fetcher:async url=>new Response(String(url).endsWith('model.json')?bytes:new Float32Array(32).fill(.25))}),/payload digest/);
console.log('Neural appearance: exact spatial bytes, digest failures and relative payload loading passed');
requests=[];await loadNeuralAppearanceBundle('http://localhost/api/read?root=image-inbox&path=family%2Fmodel.json',{sha256,fetcher:async url=>{requests.push(String(url));return new Response(String(url).includes('model.json')?bytes:payload);}});
assert.equal(requests[1],'http://localhost/api/read?root=image-inbox&path=family%2Flatents.f32','companion payload must retain the observed mounted-root read route');
