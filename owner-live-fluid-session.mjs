export async function openLiveFluidSession({getHost,setHost,getGeneration,createHost,createMlsHost},{setup,packet,backend='legacy'}) {
  if(!['legacy','mls-mpm'].includes(backend))throw Error('Unsupported fluid backend');
  const factory=backend==='mls-mpm'?createMlsHost:createHost;
  if(typeof factory!=='function')throw Error('MLS fluid backend unavailable');
  if(getHost())throw Error('A water host is already mounted');
  const generation=getGeneration();
  const candidate=await factory({setup,liveInletPacket:packet,isCurrent:()=>generation===getGeneration()&&!getHost()});
  if(!candidate)throw Error('Live water initialization expired');
  if(generation!==getGeneration()||getHost()) {candidate.dispose();throw Error('Live water initialization expired');}
  let disposed=false;
  const destroy=candidate.dispose.bind(candidate);
  candidate.dispose=()=>{if(disposed)return;disposed=true;try{destroy();}finally{if(getHost()===candidate)setHost(null);}};
  setHost(candidate);
  const assertCurrent=()=>{if(disposed||generation!==getGeneration()||getHost()!==candidate)throw Error('Live water session expired');};
  return {read:()=>{assertCurrent();return candidate.state();},
    setPacket:value=>{assertCurrent();return candidate.setLiveInletPacket(value);},
    setPaused:value=>{assertCurrent();return candidate.setPaused(value);},
    snapshot:async()=>{assertCurrent();if(!candidate.snapshot)throw Error('Fluid particle snapshot unavailable');return candidate.snapshot();},
    dispose:()=>candidate.dispose()};
}
