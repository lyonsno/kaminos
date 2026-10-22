export async function openLiveFluidSession({getHost,setHost,getGeneration,createHost},{setup,packet}) {
  if(getHost())throw Error('A water host is already mounted');
  const generation=getGeneration();
  const candidate=await createHost({setup,liveInletPacket:packet,isCurrent:()=>generation===getGeneration()&&!getHost()});
  if(!candidate)throw Error('Live water initialization expired');
  if(generation!==getGeneration()||getHost()) {candidate.dispose();throw Error('Live water initialization expired');}
  let disposed=false;
  const destroy=candidate.dispose.bind(candidate);
  candidate.dispose=()=>{if(disposed)return;disposed=true;try{destroy();}finally{if(getHost()===candidate)setHost(null);}};
  setHost(candidate);
  const assertCurrent=()=>{if(disposed||generation!==getGeneration()||getHost()!==candidate)throw Error('Live water session expired');};
  return {read:()=>{assertCurrent();return candidate.state();},
    setPacket:value=>{assertCurrent();return candidate.setLiveInletPacket(value);},
    setPaused:value=>{assertCurrent();return candidate.setPaused(value);},dispose:()=>candidate.dispose()};
}
