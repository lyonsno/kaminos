export function summarizeMovingFrame(frame){
 const {snapshot,state}=frame;
 if(state?.error)throw Error(`Moving allocator error: ${state.error}`);
 if(!snapshot||!Array.isArray(snapshot.nodes)||!Array.isArray(snapshot.values))throw Error('Missing moving snapshot');
 if(!Number.isSafeInteger(state.capacity)||state.capacity<1||snapshot.values.length!==state.capacity*64*8)throw Error('Moving pool length mismatch');
 if(!Number.isSafeInteger(state.allocatedBricks)||state.allocatedBricks>state.capacity||snapshot.nodes.length!==state.allocatedBricks)throw Error('Moving allocation length mismatch');
 if(snapshot.values.some(v=>!Number.isFinite(v)))throw Error('Moving pool must be finite');
 let burn=0,burnX=0,refinedBurn=0,refinedVolume=0,refinementX=0,fuel=0;
 for(const n of snapshot.nodes){
  if(!Number.isSafeInteger(n.slot)||n.slot<0||n.slot>=state.capacity||!Number.isFinite(n.pitch)||n.pitch<=0||!Array.isArray(n.lo)||n.lo.length!==3||n.lo.some(v=>!Number.isFinite(v)))throw Error('Invalid moving snapshot coordinates');
  if(!Number.isSafeInteger(n.level)||n.level<0)throw Error('Invalid moving refinement level');
  if(n.children)continue;
  const dv=n.pitch**3;
  if(n.level>0){refinedVolume+=64*dv;refinementX+=(n.lo[0]+2*n.pitch)*64*dv;}
  for(let c=0;c<64;c++){
   const offset=(n.slot*64+c)*8,b=snapshot.values[offset+4]*dv;
   burn+=b;burnX+=b*(n.lo[0]+(c%4+.5)*n.pitch);fuel+=snapshot.values[offset+2]*dv;if(n.level>0)refinedBurn+=b;
  }
 }
 if(!(burn>0)||!(fuel>0))throw Error('Moving pocket lost burning material');
 return {step:frame.step,burn,fuel,burnX:burnX/burn,refinedBurnFraction:refinedBurn/burn,refinementX:refinedVolume?refinementX/refinedVolume:null,refinedVolume,revision:state.revision};
}

export function validateMovingEvidence(result){
 if(!result||!Array.isArray(result.frames)||result.frames.length!==18)throw Error('Expected eighteen moving frames');
 if(result.frames.some((f,i)=>f.step!==i))throw Error('Moving frames are stale, duplicated or out of order');
 const frames=result.frames.map(summarizeMovingFrame),first=frames[1],last=frames.at(-1);
 const width=result.plan.materialPitch*4;
 if(!Number.isFinite(width)||width<=0)throw Error('Invalid moving material pitch');
 if(!(last.burnX-first.burnX>width))throw Error('Burning pocket did not cross a coarse brick');
 const minimumRefinedBurnFraction=Math.min(...frames.slice(1).map(f=>f.refinedBurnFraction));
 if(minimumRefinedBurnFraction<.5)throw Error('Moving refinement did not retain most burning material after startup');
 if(!Number.isFinite(first.refinementX)||!Number.isFinite(last.refinementX)||!(last.refinementX-first.refinementX>width))throw Error('Moving refinement stayed behind the burning pocket');
 return {frames,burnTravel:last.burnX-first.burnX,refinementTravel:last.refinementX-first.refinementX,coarseBrickWidth:width,minimumRefinedBurnFraction};
}
