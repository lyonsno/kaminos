// One pass through the existing operations, driven by their actual completion.
export function createCastingCycle({read,actions}){
 let running=false,phase='idle',error=null,generation=0,pending=null;
 const state=()=>({running,phase,error});
 async function stop(){running=false;generation++;phase='stopped';await actions.stop();return state();}
 async function tick(){
  if(!running||pending)return pending;
  const token=generation;
  const current=()=>running&&token===generation;
  const act=async name=>{await actions[name]();if(!current()){await actions.stop();return false;}return true;};
  pending=(async()=>{try{
   const s=read();
   if(phase==='pouring'){if(await act('pour'))phase='filling';}
   else if(phase==='filling'){
    const filled=await actions.sampleFill();if(!current())return;
    if(filled&&await act('stopPour')&&await act('unmold'))phase='lifting';
   }else if(phase==='lifting'&&!s.transfer?.moving){if(await act('carry'))phase='carrying';}
   else if(phase==='carrying'&&!s.carriage?.moving){if(await act('ignite'))phase='igniting';}
   else if(phase==='igniting'&&!s.igniting){if(await act('returnLoader'))phase='returning';}
   else if(phase==='returning'&&!s.carriage?.moving){phase='complete';running=false;}
  }catch(e){if(current()){error=e.message;running=false;phase='failed';generation++;try{await actions.stop();}catch(stopError){error+='; '+stopError.message;}}}
  })().finally(()=>pending=null);
  return pending;
 }
 return {read:state,settled:()=>pending??Promise.resolve(),start(){if(running)return state();if(pending)throw Error('Let the stopped operation finish before restarting');if(phase==='complete'&&read().pieceId)throw Error('Remove the current casting before running the next letter');error=null;running=true;generation++;phase=read().pieceId?'lifting':'pouring';return state();},tick,stop};
}
