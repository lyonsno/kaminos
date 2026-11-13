// Only click intent, canvas measurements and the view cross the boundary.
// Geometry queries and canonical selection run in the worker foreground service.
export function installSceneWorkerPointerSelection({canvases,page,readCamera,report=()=>{}}){
 let start=null,closed=false;
 const stops=[];
 for(const canvas of Object.values(canvases)){
  const down=event=>{start=null;if(closed||page.read().phase!=='active'||event.button!==0||event.pointerType==='touch')return;start={id:event.pointerId,x:event.clientX,y:event.clientY};};
  const up=event=>{
   const prior=start;start=null;
   if(closed||page.read().phase!=='active'||!prior||event.button!==0||event.pointerType==='touch'||prior.id!==event.pointerId||Math.hypot(event.clientX-prior.x,event.clientY-prior.y)>5)return;
   const rect=canvas.getBoundingClientRect();
   if(!(rect.width>0&&rect.height>0))return;
   const ndc={x:2*(event.clientX-rect.left)/rect.width-1,y:1-2*(event.clientY-rect.top)/rect.height};
   if(Math.abs(ndc.x)>1||Math.abs(ndc.y)>1)return;
   try{const handle=page.request('scene.pick',{ndc,viewport:{width:rect.width,height:rect.height},camera:readCamera(),extend:!!event.shiftKey});handle.completion.catch(error=>{if(!closed)report('Selection: '+error.message);});}
   catch(error){report('Selection: '+error.message);}
  };
  const cancel=()=>{start=null;};
  for(const [type,handler]of [['pointerdown',down],['pointerup',up],['pointercancel',cancel],['lostpointercapture',cancel]]){canvas.addEventListener(type,handler);stops.push(()=>canvas.removeEventListener(type,handler));}
 }
 return Object.freeze({clear(){start=null;},dispose(){closed=true;start=null;for(const stop of stops)stop();}});
}
