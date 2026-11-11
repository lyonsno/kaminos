export function createSpacePreviewQueue({apply,requestFrame,cancelFrame}){
 let frame=null,pending=false,value;
 function flush(){if(frame!==null)cancelFrame(frame);frame=null;if(!pending)return;pending=false;apply(value);}
 return {set(next){value=next;pending=true;if(frame===null)frame=requestFrame(flush);},flush,cancel(){if(frame!==null)cancelFrame(frame);frame=null;pending=false;}};
}
