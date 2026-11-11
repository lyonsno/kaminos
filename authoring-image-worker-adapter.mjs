import {createKleinAuthoringImageGeneration} from './authoring-image-operation.mjs';

// Construct inside the scene worker's runtime factory. The application host and
// model resources stay local; only progress and stored asset references leave it.
export function createKleinSceneWorkerAdapter({deliver,changed,appHost,...options}={}){
  if(typeof appHost!=='function'||typeof deliver!=='function')throw TypeError('Worker image adapter needs appHost and deliver');
  let active=null;
  const tickets=new Map(),diagnostics=[];
  const operation=createKleinAuthoringImageGeneration({...options,appHost,deliver,changed(state){
    if(!active)return;
    if(!active.runId)active.runId=state.request?.id;
    const ctx=active.context;
    try{ctx.assertCurrent();}catch{return;}
    const output=state.outputs.find(value=>value.id===active.runId);
    const preview=output?.preview??state.preview;
    const progress={request:state.request,status:state.status,stage:state.stage,percent:state.percent,
      progress:state.progress,timing:state.timing,canStop:state.canStop,canDecode:state.canDecode,
      preview:preview?.kind==='partial'?preview:null};
    try{ctx.report(progress);changed?.(progress);}catch(error){
      diagnostics.push({phase:'progress',requestId:ctx.requestId,name:error?.name??'Error',message:String(error?.message??error)});
    }
  }});
  async function save(file,provenance,ticket){
    const ctx=ticket.context;
    ctx.assertCurrent();
    const entry=await deliver(file,provenance,{origin:ticket.origin,requestId:ctx.requestId,epoch:ctx.epoch(),assertCurrent:ctx.assertCurrent});
    ctx.assertCurrent();
    return entry;
  }
  async function execute(ctx,ticket,run){
    ctx.assertCurrent();
    if(active)throw Error('Worker image operation is already active');
    active=ticket;
    try{
      const entry=await run();
      ctx.assertCurrent();
      return {entry,runId:ticket.runId,origin:ticket.origin,diagnostics:[...diagnostics]};
    }finally{
      if(ticket.runId){
        if(operation.read().outputs.some(output=>output.id===ticket.runId&&output.pending))tickets.set(ticket.runId,ticket);
        else tickets.delete(ticket.runId);
      }
      active=null;
    }
  }
  return Object.freeze({operation,commands:{
    'image.generate':(payload,ctx)=>ctx.withFrames(()=>{
      const ticket={context:ctx,runId:null,origin:{requestId:ctx.requestId,epoch:ctx.epoch()}};
      return execute(ctx,ticket,()=>operation.run({...payload,signal:ctx.signal,deliver:(file,provenance)=>save(file,provenance,ticket)}));
    }),
    'image.retrySave':(payload,ctx)=>ctx.withFrames(()=>{
      const ticket=tickets.get(payload?.runId);
      if(!ticket)throw Error('Unknown worker image output');
      ticket.context=ctx;
      return execute(ctx,ticket,()=>operation.retryOutput(payload.runId));
    }),
    'image.read':(_payload,ctx)=>{ctx.assertCurrent();return {state:operation.read(),controls:['decodeNow'],stop:'cancel'};},
  },
    control(action,_payload,ctx){
      ctx.assertCurrent();
      if(!active||active.context.requestId!==ctx.requestId)throw Error('Worker image control target is not active');
      if(action!=='decodeNow')throw Error(`Unsupported image control: ${action}`);
      return {accepted:operation.decodeNow()};
    },
    retire:()=>operation.destroy(),
  });
}
