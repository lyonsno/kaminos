export function finiteLandingSummary(initial,witness,worldY,floorHeight){
 const state=witness.state,reference=initial.state,n=state?.model?.points;
 if(state?.runId!==reference?.runId||!Number.isSafeInteger(state?.steps)||state.steps<=reference.steps||state.model?.points!==reference.model?.points)throw Error('Same advancing material run identity required');
 if(!Number.isFinite(witness.configuration?.gravity)||witness.configuration.gravity<=0)throw Error('Enabled finite gravity required');
 if(!['full-diagnostic','frame'].includes(state.observation?.kind)||state.state?.length!==n*16||reference.state?.length!==n*16||!state.state.every(Number.isFinite)||!reference.state.every(Number.isFinite))throw Error('Complete acquired physical material state required');
 const surface=witness.surfaceObservation;if(surface?.source!=='native-webgpu-transport-compute-readback'||surface.runId!==state.runId||surface.steps!==state.steps||!surface.pieces?.length||surface.pieces.some(p=>!p.gpu?.length||!p.gpu.every(v=>v.length===3&&v.every(Number.isFinite))))throw Error('Current complete native finite surface required');
 const components=initial.residentInteraction?.components;if(components?.length!==n||!components.every(Number.isSafeInteger))throw Error('Acquired initial component identity required');
 const pinned=new Set();for(let i=0;i<n;i++)if(reference.state[i*16+11]===1)pinned.add(components[i]);
 let detached=0,maxFall=0,maxDetachedSpeed=0,maxPinnedTravel=0;
 for(let i=0;i<n;i++){
  if(reference.state[i*16+11]===1)maxPinnedTravel=Math.max(maxPinnedTravel,Math.hypot(...[0,1,2].map(k=>state.state[i*16+4+k]-reference.state[i*16+4+k])));
  if(!pinned.has(components[i])){detached++;maxFall=Math.max(maxFall,reference.state[i*16+5]-state.state[i*16+5]);maxDetachedSpeed=Math.max(maxDetachedSpeed,Math.hypot(...state.state.slice(i*16+8,i*16+11)));}
 }
 let minWorldGap=Infinity;for(const piece of surface.pieces)for(const point of piece.gpu)minWorldGap=Math.min(minWorldGap,point[1]+worldY-floorHeight);
 return{runId:state.runId,steps:state.steps-reference.steps,detached,maxFall,maxDetachedSpeed,maxPinnedTravel,minWorldGap};
}
