// kaminos-test: node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadFullBodySources} from '../experiments/creature-motion/full-body-source.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const I = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const bones = [{name:'pelvis',parent:null,restMatrix:I}];
async function fixture({conditioning='c'.repeat(64), frameIdentityCorrect=true}={}) {
 const data = new Map();
 const frame = {schema:'kaminos.full-given-rig-frame.v1',bones,canonicalWorldToSourceNormalized:I,
  source:{assetConditioningSha256:conditioning}};
 const motion = {status:'completed',route:'unimate.text-to-motion.webgpu-local.v0',textEncoder:'browser T5',
  cooperative:true,controllerNorm:'valid-joints',assetCondSha256:'c'.repeat(64)};
 data.set('frame',encode(frame));data.set('motion',encode(motion));
 const manifest = {schema:'kaminos.live-transport.v3',status:'completed',candidatePaintedWeights:false,
  sourceSha256:'a'.repeat(64),sourceCast:'test-cast',vertices:3,triangles:1,bones,channels:['fixed','pelvis'],
  presets:[{name:'rest'}],reference:{kind:'none',reason:'no paint'},
  provenance:{packageSha256:'b'.repeat(64),rigSourceSha256:'a'.repeat(64),frameChainSha256:frameIdentityCorrect?digest(data.get('frame')):'d'.repeat(64)},assets:{}};
 for (const [name,array,shape] of [
  ['rest.bin',new Float32Array([0,0,0,1,0,0,0,1,0]),[3,3]],
  ['triangles.bin',new Uint32Array([0,1,2]),[1,3]],
  ['automatic-weights.bin',new Float32Array([0,1,0,1,0,1]),[3,2]],
  ['automatic-presets.bin',new Float32Array([0,0,0,1,0,0,0,1,0]),[1,3,3]],
 ]) {
  const bytes=new Uint8Array(array.buffer);data.set('case/'+name,bytes);
  manifest.assets[name]={sha256:digest(bytes),bytes:bytes.length,shape,dtype:name==='triangles.bin'?'<u4':'<f4'};
 }
 data.set('case/manifest.json',encode(manifest));
 const inputs={case:'case',case_sha256:digest(data.get('case/manifest.json')),motion:'motion',motion_sha256:digest(data.get('motion')),frame:'frame',frame_sha256:digest(data.get('frame'))};
 return loadFullBodySources(inputs,{fetchImpl:async url=>new Response(data.get(url),{status:data.has(url)?200:404})});
}
await fixture();
await assert.rejects(()=>fixture({conditioning:'e'.repeat(64)}),/conditioning/i,
 'same names and rest matrices must not admit motion generated for different conditioning');
await assert.rejects(()=>fixture({frameIdentityCorrect:false}),/frame.*identity|frame.*digest/i,
 'a numerically similar frame must not impersonate the package bind source');
console.log('Candidate playback binds motion conditioning and frame digest to the actual skin source');
