// Model-owned snapshot format shared by live presentation and retained replay.
// These are occupied cells, not a decoded fine mesh or colors from latent channels.
export const VOXEL_HISTORY_SCHEMA='trellis2.voxel-history.v1';
export const VOXEL_FRAME_SCHEMA='trellis2.voxel-frame.v1';
const text=(x,name)=>{if(typeof x!=='string'||!x.trim())throw TypeError(name+' required');return x;};
export const trellisHistoryUrl=runId=>'/api/trellis-history?'+new URLSearchParams({runId:text(runId,'run identity')});
export function validateVoxelFrame(frame,coordinates){
 if(frame?.schema!==VOXEL_FRAME_SCHEMA||frame.representation!=='occupied-cells')throw TypeError('TRELLIS occupied-cell frame required');
 for(const key of ['id','runId','stage','routeId'])text(frame[key],key);
 const dims=frame.grid?.dimensions,spatial=frame.spatial;
 if(!Array.isArray(dims)||dims.length!==3||!dims.every(n=>Number.isSafeInteger(n)&&n>0)||
  !Number.isSafeInteger(frame.count)||frame.count<0||frame.count>dims.reduce((a,b)=>a*b,1)||
  !Number.isSafeInteger(frame.step)||frame.step<0||!Number.isSafeInteger(frame.steps)||frame.steps<frame.step||
  !Number.isFinite(frame.atSeconds)||frame.atSeconds<0)throw TypeError('complete voxel grid, count and sampling clock required');
 if(!spatial||spatial.frame!=='trellis-source'||!['scale','offset'].every(k=>Array.isArray(spatial.gridToSource?.[k])&&spatial.gridToSource[k].length===3&&spatial.gridToSource[k].every(Number.isFinite))||
  spatial.gridToSource.scale.some(v=>v<=0)||!Array.isArray(spatial.cellCenterOffset)||spatial.cellCenterOffset.length!==3||!spatial.cellCenterOffset.every(Number.isFinite)||
  !Array.isArray(spatial.sourceToGltf)||spatial.sourceToGltf.length!==16||!spatial.sourceToGltf.every(Number.isFinite)||
  frame.layout?.dtype!=='int32'||JSON.stringify(frame.layout.shape)!==JSON.stringify([frame.count,3])||frame.layout.rowOrder!=='z-y-x-lexicographic')throw TypeError('explicit source frame, transforms and packed Int32[N,3] layout required');
 if(coordinates!==undefined){
  if(!(coordinates instanceof Int32Array)||coordinates.length!==frame.count*3)throw TypeError('complete Int32 voxel rows required');
  let last=-1;
  for(let i=0;i<frame.count;i++){
   const z=coordinates[i*3],y=coordinates[i*3+1],x=coordinates[i*3+2],key=(z*dims[1]+y)*dims[2]+x;
   if(z<0||y<0||x<0||z>=dims[0]||y>=dims[1]||x>=dims[2]||key<=last)throw RangeError('voxel rows must be in-grid, source-ordered and unique');last=key;
  }
 }
 return frame;
}
export function voxelFrameFromPreview(preview,{id=preview.stage+':'+preview.step,atSeconds=0,state='completed-stage',provenance=null}={}){
 const frame={schema:VOXEL_FRAME_SCHEMA,representation:'occupied-cells',id,runId:preview.runId,stage:preview.stage,routeId:preview.routeId,
  count:preview.count,step:preview.step,steps:preview.steps,atSeconds,state,grid:structuredClone(preview.grid),layout:structuredClone(preview.layout),
  spatial:structuredClone(preview.spatial),...(provenance?{provenance:structuredClone(provenance)}:{})};
 return validateVoxelFrame(frame);
}
export function validateVoxelHistory(value,runId=value?.runId){
 if(value?.schema!==VOXEL_HISTORY_SCHEMA||value.runId!==runId||typeof value.label!=='string'||!value.label.trim()||
  !['live-generation','retained-reference-replay'].includes(value.source?.kind)||!Array.isArray(value.frames))throw TypeError('history does not match the requested TRELLIS run');
 const ids=new Set();
 for(const frame of value.frames){validateVoxelFrame(frame);if(frame.runId!==runId||ids.has(frame.id))throw Error('mixed or duplicate history frame identity');ids.add(frame.id);
  if(!/^[a-f0-9]{64}$/.test(frame.coordinates?.sha256??'')||frame.coordinates.byteLength!==frame.count*12)throw Error('history frame needs its complete coordinate digest');}
 return value;
}
export async function readVoxelHistoryFrame({frame,fetcher=fetch}){
 const url=trellisHistoryUrl(frame.runId)+'&'+new URLSearchParams({frameId:frame.id});
 const response=await fetcher(url,{cache:'no-store'});if(!response.ok)throw Error('Retained voxel frame HTTP '+response.status);
 const raw=await response.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),n=>n.toString(16).padStart(2,'0')).join('');
 if(raw.byteLength!==frame.coordinates.byteLength||sha!==frame.coordinates.sha256)throw Error('Retained voxel bytes are partial or changed');
 const rows=new Int32Array(raw);validateVoxelFrame(frame,rows);return rows;
}
export function coordinatesBase64(coordinates){
 const bytes=new Uint8Array(coordinates.buffer,coordinates.byteOffset,coordinates.byteLength);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);
}
