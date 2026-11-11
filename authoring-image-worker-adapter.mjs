import {createKleinAuthoringImageGeneration} from './authoring-image-operation.mjs';

function previewMetadata(preview){
  if(!preview)return null;
  const {rgba,...metadata}=preview;return metadata;
}
function projectState(state,runId=state.request?.id){
  const output=state.outputs.find(value=>value.id===runId);
  const status=output?.pending&&output.status==='generating'?'saving':
    ['saving','complete','failed','stopped'].includes(output?.status)?output.status:state.status;
  return {...state,status,error:output?.error??state.error,
    ...(status==='saving'?{stage:'Saving image',percent:null,progress:'Saving the image…'}:{}),
    preview:previewMetadata(state.preview),outputs:state.outputs.map(value=>({...value,preview:previewMetadata(value.preview)}))};
}

// Construct inside the scene worker's runtime factory. The application host and
// model resources stay local; only progress and stored asset references leave it.
export function createKleinSceneWorkerAdapter({deliver,changed,appHost,...options}={}){
  if(typeof appHost!=='function'||typeof deliver!=='function')throw TypeError('Worker image adapter needs appHost and deliver');
  let active=null;
  const tickets=new Map(),diagnostics=[];
  const operation=createKleinAuthoringImageGeneration({...options,appHost,deliver,retainOutputPixels:false,
    isRetryableOutputError:error=>error?.retryable!==false,changed(state){
    if(!active)return;
    if(!active.runId)active.runId=state.request?.id;
    const ctx=active.context;
    try{ctx.assertCurrent();}catch{return;}
    const output=state.outputs.find(value=>value.id===active.runId);
    const preview=output?.preview??state.preview;
    const projected=projectState(state,active.runId);
    const progress={request:state.request,outputId:active.runId,status:projected.status,stage:projected.stage,percent:projected.percent,
      progress:projected.progress,error:projected.error,timing:state.timing,canStop:state.canStop,canDecode:state.canDecode,
      preview:preview?.kind==='partial'?preview:null};
    try{ctx.report(progress);changed?.(progress);}catch(error){
      diagnostics.push({phase:'progress',requestId:ctx.requestId,name:error?.name??'Error',message:String(error?.message??error)});
    }
  }});
  async function save(file,provenance,ticket){
    const ctx=ticket.context;
    const check=()=>{try{ctx.assertCurrent();}catch(error){error.retryable=false;throw error;}};
    check();
    let entry;
    try{entry=await deliver(file,provenance,{origin:ticket.origin,requestId:ctx.requestId,epoch:ctx.epoch(),assertCurrent:ctx.assertCurrent});}
    catch(error){check();throw error;}
    check();
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
      ctx.assertCurrent();
      const epoch=ctx.epoch();
      if(ticket.context.signal.aborted||Object.keys(ticket.origin.epoch).some(part=>epoch[part]!==ticket.origin.epoch[part])){
        operation.discardOutput(payload.runId,'Image output belongs to a canceled request or stale worker epoch');tickets.delete(payload.runId);
        throw Error('Image output belongs to a canceled request or stale worker epoch');
      }
      ticket.context=ctx;
      return execute(ctx,ticket,()=>operation.retryOutput(payload.runId));
    }),
    'image.read':(_payload,ctx)=>{ctx.assertCurrent();return {state:projectState(operation.read()),controls:['decodeNow'],stop:'cancel'};},
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
