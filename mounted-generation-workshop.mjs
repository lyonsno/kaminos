import {createGenerationArrival} from './generation-arrival.mjs';

// Preparation is explicit and happens before interaction. Enter only expresses
// intent; it never allocates a simulator, loads an asset, or starts a GPU job.
export function createMountedGenerationWorkshop({acquire,onFrame,changed=()=>{},duration=2}) {
 let phase='unprepared',error=null,wanted=false,stage=null,arrival=null,stop=null,pending=null,epoch=0,closed=false,abort=null;
 const read=()=>({phase,error,wanted,amount:arrival?.read().amount??0,ids:[...(stage?.ids??[])]});
 const publish=()=>changed(read());
 function begin(){if(!stage||!wanted)return;arrival.enter();phase='entering';publish();}
 const api={read,
  prepare(){
   if(closed)throw Error('Workshop is disposed');
   if(stage||pending)return pending??Promise.resolve(read());
   const token=epoch;abort=new AbortController();const signal=abort.signal;phase='preparing';error=null;publish();
   const acquisition=Promise.resolve().then(()=>acquire({signal}));
   pending=(async()=>{try{
    const result=await acquisition;
    if(closed||token!==epoch){await result.dispose();return read();}
    stage=result;
    arrival=createGenerationArrival({duration,place:()=>stage.place(),present:value=>stage?.present(value??0)});
    stop=onFrame(({deltaSeconds})=>{
     arrival.advance(deltaSeconds);
     const {amount,direction}=arrival.read();
     const next=direction>0?'entering':direction<0?'leaving':amount===1?'open':'closed';
     if(next!==phase){phase=next;publish();}
    });
    phase='closed';if(wanted)begin();else publish();
   }catch(cause){if(token===epoch&&!closed){phase='error';error=cause.message;publish();}}
   finally{if(token===epoch)pending=null;}
   return read();})();
   return pending;
  },
  enter(){if(closed)return;wanted=true;if(stage&&arrival.read().direction!==1&&arrival.read().amount!==1)begin();else publish();return read();},
  exit(){wanted=false;if(arrival){arrival.exit();phase='leaving';}publish();return read();},
  async reset(){
   ++epoch;wanted=false;abort?.abort();stop?.();stop=null;
   arrival?.dispose();arrival=null;
   const old=stage,work=pending;stage=null;pending=null;
   if(old)await old.dispose();if(work)await work;
   phase=closed?'disposed':'unprepared';error=null;publish();
  },
  async dispose(){if(closed)return;closed=true;await api.reset();},
 };
 return api;
}

// Temporary editable registrations must not become authored document members.
export function withoutMountedWorkshop(document,owns) {
 const objects=document.objects.filter(row=>!owns(row.id));
 const groups=(document.groups??[]).filter(row=>!owns(row.id)).map(row=>({...row,objectIds:row.objectIds.filter(id=>!owns(id))})).filter(row=>row.objectIds.length);
 const selectionIds=(document.selectionIds??[]).filter(id=>!owns(id)&&!owns(id.replace(/^@group:/,''))&&(!id.startsWith('@group:')||groups.some(g=>g.id===id.slice(7))));
 return {...document,objects,groups,selectionIds,
  activeObjectId:owns(document.activeObjectId)?selectionIds.find(id=>!id.startsWith('@group:'))??null:document.activeObjectId,
  activeGroupId:groups.some(row=>row.id===document.activeGroupId)?document.activeGroupId:null,
  editorDisplay:{...document.editorDisplay,hiddenIds:(document.editorDisplay?.hiddenIds??[]).filter(id=>!owns(id))},
 };
}
