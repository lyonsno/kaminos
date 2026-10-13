export async function stoneObservationStamp(data){
 const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),v=>v.toString(16).padStart(2,'0')).join('');
 const [digest,physicalDigest]=await Promise.all([hash(data),hash({...data,camera:undefined})]);
 return {schema:'stone-observation-stamp-v2',current:data.state?.observation?.kind!=='submitted',grip:data.state?.grip?structuredClone(data.state.grip):null,route:data.route,runId:data.state?.runId,steps:data.state?.steps,
  paused:data.paused,busy:data.busy,pendingPick:data.pendingPick,finishing:data.finishing,failure:data.failure,
  resourceVersion:data.resourceVersion,digest,physicalDigest,camera:structuredClone(data.camera)};
}

export const STONE_CAMERA_STABILITY_TOLERANCE=1e-9;
export function assertStableStoneObservationStamps(before,after){
 for(const stamp of [before,after]){
  validateStoneObservationStamp(stamp);
  if(!/^[a-f0-9]{64}$/.test(stamp.physicalDigest??''))throw Error('Complete exact physical stamp required');
  if(!stamp.camera||!['position','target','up'].every(key=>Array.isArray(stamp.camera[key])&&stamp.camera[key].length===3&&stamp.camera[key].every(Number.isFinite))||!['near','far','fov'].every(key=>Number.isFinite(stamp.camera[key])))throw Error('Complete finite camera state required');
 }
 if(before.physicalDigest!==after.physicalDigest)throw Error('Stone physical state changed during capture');
 for(const key of new Set([...Object.keys(before.camera),...Object.keys(after.camera)])){
  const a=before.camera[key],b=after.camera[key];
  if(['position','target','up'].includes(key)){if(a.some((v,i)=>Math.abs(v-b[i])>STONE_CAMERA_STABILITY_TOLERANCE))throw Error('Stone camera changed during capture');}
  else if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Stone camera lens or metadata changed during capture');
 }
}

export function validateStoneObservationStamp(s){
 if(s?.schema!=='stone-observation-stamp-v2'||s.current!==true||s.route!=='kaminos.picked-stone.bounded-shards.webgpu.v0'
  ||!s.runId||!Number.isInteger(s.steps)||!s.paused||s.busy||s.pendingPick||s.finishing||s.failure
  ||s.resourceVersion!==s.runId||! /^[a-f0-9]{64}$/.test(s.digest??''))throw new Error('Held bounded stone stamp required');
}

export function reconstructStoneObservation(dynamic,resource){
 if(resource?.schema!=='stone-observation-resource-v1'||resource.version!==dynamic.runId
  ||!Array.isArray(resource.pieces)||!Array.isArray(dynamic.pieces)||resource.pieces.length!==dynamic.pieces.length)
  throw new Error('Exact stone resource identity required');
 const ids=new Set();
 const support=resource.elasticSupport;
 if(dynamic.materialRegime?.connectivity==='kaminos.bounded-connectivity.elastic-support.v1'&&(support?.route!==dynamic.materialRegime.connectivity||!Array.isArray(support.elements)||support.elements.length!==dynamic.state?.model?.elements||support.elements.some(e=>!Array.isArray(e)||e.length!==4||new Set(e).size!==4||e.some(i=>!Number.isInteger(i)||i<0||i>=dynamic.state.model.points))))throw new Error('Complete exact elastic support resource required');
 return {...dynamic,...(support?{elasticSupport:support}:{}),pieces:dynamic.pieces.map(p=>{
  const matches=resource.pieces.filter(r=>r.id===p.id);
  if(matches.length!==1||ids.has(p.id)||!matches[0].geometry||!matches[0].binding)throw new Error('Complete unique stone resource required');
  ids.add(p.id);return {...p,geometry:matches[0].geometry,binding:matches[0].binding};
 })};
}
