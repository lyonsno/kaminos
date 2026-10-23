import {validateLiveManifest} from '../../hindquarter-live-core.mjs';
import {validateGivenMotionSource} from './given-motion-source.mjs';

function sourceLoader(fetchImpl) {
 const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 async function load(url,expected,size){
  if(typeof url!=='string'||!url.trim()||!/^[a-f0-9]{64}$/i.test(expected??''))throw Error('Explicit source URL and digest required');
  const response=await fetchImpl(url,{cache:'no-store'});if(!response.ok)throw Error(`Source HTTP ${response.status}: ${url}`);
  const bytes=await response.arrayBuffer();if(size!==undefined&&bytes.byteLength!==size)throw Error(`Incomplete source: ${url}`);
  const actual=await sha(bytes);if(actual!==expected.toLowerCase())throw Error(`Source digest mismatch: ${url}`);return {bytes,sha256:actual};
 }
 return {load,json:loaded=>JSON.parse(new TextDecoder().decode(loaded.bytes))};
}

export async function loadFullBodySkin(inputs,{fetchImpl=globalThis.fetch}={}) {
 const {load,json}=sourceLoader(fetchImpl);
 if(typeof inputs?.case!=='string'||!inputs.case.trim())throw Error('Explicit skin source URL required');
 const caseRoot=inputs.case.replace(/\/$/,'');
 const skin=await load(`${caseRoot}/manifest.json`,inputs.case_sha256),manifest=validateLiveManifest(json(skin));
 if(manifest.schema!=='kaminos.live-transport.v3')throw Error('Walking creature requires the given full-body case');
 const arrays={};
 for(const name of ['rest.bin','triangles.bin','automatic-weights.bin','automatic-presets.bin']){const spec=manifest.assets[name],asset=await load(`${caseRoot}/${name}`,spec.sha256,spec.bytes);arrays[name]=name==='triangles.bin'?new Uint32Array(asset.bytes):new Float32Array(asset.bytes);}
 for(const [name,array] of Object.entries(arrays))if(name!=='triangles.bin'&&!array.every(Number.isFinite))throw Error(`Nonfinite source: ${name}`);
 if(arrays['triangles.bin'].some(i=>i>=manifest.vertices))throw Error('Triangle index outside body');
 return {manifest,rest:arrays['rest.bin'],triangles:arrays['triangles.bin'],weights:arrays['automatic-weights.bin'],source:{caseSha256:skin.sha256}};
}

export async function loadFullBodySources(inputs,{fetchImpl=globalThis.fetch}={}) {
 const skin=await loadFullBodySkin(inputs,{fetchImpl}),{manifest}=skin,{load,json}=sourceLoader(fetchImpl);
 const motionLoad=inputs.motion_data!==undefined?await (async()=>{if(typeof inputs.motion_data!=='string')throw Error('Embedded motion must be serialized JSON');const bytes=new TextEncoder().encode(inputs.motion_data);const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(actual!==inputs.motion_sha256)throw Error('Embedded motion digest mismatch');return {bytes,sha256:actual};})():await load(inputs.motion,inputs.motion_sha256),frameLoad=await load(inputs.frame,inputs.frame_sha256),motion=json(motionLoad),frame=json(frameLoad);
 const prefixLoad=motion.continuation?await load(inputs.prefix,inputs.prefix_sha256):null;
 const profile=validateGivenMotionSource({motion,prefix:prefixLoad?json(prefixLoad):null,prefixSha256:prefixLoad?.sha256});
 if(frame.schema!=='kaminos.full-given-rig-frame.v1'||frame.bones?.length!==manifest.bones.length||frame.bones.some(b=>{const target=manifest.bones.find(t=>t.name===b.name);return !target||target.parent!==b.parent||b.restMatrix.flat().some((v,i)=>Math.abs(v-target.restMatrix.flat()[i])>1e-5);}))throw Error('Retained bind frame differs from the actual full-body skin');
 return {...skin,motion,frame,
  source:{...skin.source,motionSha256:motionLoad.sha256,frameSha256:frameLoad.sha256,motionRoute:motion.route,textEncoder:motion.textEncoder,...profile}};
}
