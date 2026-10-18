import {loadFullBodySkin} from './full-body-source.mjs';
import {validateGivenMotionSource} from './given-motion-source.mjs';
import {createGivenPaletteMotion} from './given-palette-motion.mjs';
import {extendRestDescendantMotion} from './rest-descendant-motion.mjs';

export async function loadRigCastSources(inputs,{THREE,fetchImpl=globalThis.fetch,loadSkin=loadFullBodySkin}={}) {
 const json=async(path,expected)=>{
  if(typeof path!=='string'||!/^[a-f0-9]{64}$/i.test(expected??''))throw Error('Explicit rig-cast source and digest required');
  const response=await fetchImpl(path,{cache:'no-store'});if(!response.ok)throw Error(`Source HTTP ${response.status}: ${path}`);
  const bytes=await response.arrayBuffer(),actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(actual!==expected.toLowerCase())throw Error('Rig-cast source digest mismatch: '+path);
  return JSON.parse(new TextDecoder().decode(bytes));
 };
 const skin=await loadSkin(inputs,{fetchImpl});
 const [motion,base,frame]=await Promise.all([json(inputs.motion,inputs.motion_sha256),json(inputs.base_frame,inputs.base_frame_sha256),json(inputs.frame,inputs.frame_sha256)]);
 if(base.schema!=='kaminos.full-given-rig-frame.v1'||frame.schema!==base.schema||skin.manifest.provenance.frameChainSha256!==inputs.frame_sha256)throw Error('Rig-cast bind frame source differs');
 const target=new Map(frame.bones.map(b=>[b.name,b]));
 if(target.size!==skin.manifest.bones.length||skin.manifest.bones.some(b=>{
  const next=target.get(b.name);return !next||next.parent!==b.parent||next.restMatrix.flat().some((v,i)=>v!==b.restMatrix.flat()[i]);
 }))throw Error('Rig-cast skin/frame records differ');
 const prefix=motion.continuation?await json(inputs.prefix,inputs.prefix_sha256):null;
 const profile=validateGivenMotionSource({motion,prefix,prefixSha256:inputs.prefix_sha256});
 const adapter=extendRestDescendantMotion({THREE,adapter:createGivenPaletteMotion({THREE,motion,rigFrame:base}),sourceFrame:base,targetFrame:frame});
 return {...skin,adapter,frame,motion,baseFrame:base,source:{...skin.source,...profile,motionSha256:inputs.motion_sha256,frameSha256:inputs.frame_sha256,
  baseFrameSha256:inputs.base_frame_sha256,motionRoute:motion.route,effectiveMotionRoute:'retained-source-plus-fixed-rest-descendants',derivation:adapter.derivation}};
}
