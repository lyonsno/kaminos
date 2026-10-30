// A view of the admitted prompt in an independently reconstructed authored kiln.
// The source text and the progressive image stay with their existing owners.
export function installGenerationFlame({document,slot,createRenderer}){
 const tile=document.createElement('div');tile.className='generation-flame';tile.hidden=true;
 const volume=document.createElement('div');volume.className='generation-flame-volume';
 const status=document.createElement('span');status.className='generation-flame-status';status.setAttribute('role','status');
 tile.append(volume,status);slot.append(tile);
 let renderer=null,startup=null,running=false,visible=false,disposed=false,lastError=null,request=null,epoch=0,lifecycle=Promise.resolve(),renderedKey=null,allowCold=true,refreshPending=false;
 const draft=()=>document.getElementById('asset-prompt')?.value??'';
 const abort=()=>startup?.abort(new DOMException('Kiln view superseded','AbortError'));
 function sync({refresh=false}={}){
  const key=request?.id??draft();
  if(refresh||key!==renderedKey||!visible){epoch++;abort();}
  const generation=epoch;
  lifecycle=lifecycle.catch(()=>{}).then(async()=>{
   if(generation!==epoch)return;
   if(disposed||!visible){if(renderer){await renderer.setActive(false);if(disposed){await renderer.dispose();renderer=null;}}if(!renderer)renderedKey=null;return;}
   if(renderer&&renderedKey!==key){await renderer.setActive(false);if(renderer.prepare&&renderedKey!==null){await renderer.prepare({prompt:running?(request?.prompt??draft()):draft(),request:running?request:null,input:document.getElementById('asset-prompt')});renderedKey=key;}else{await renderer.dispose();renderer=null;}}
   if(!renderer&&!running&&!allowCold)return;
   if(!renderer){
    refreshPending=false;startup=new AbortController();status.textContent='Loading kiln…';
    try{
     const value=await createRenderer(volume,{signal:startup.signal,prompt:running?(request?.prompt??draft()):draft(),request:running?request:null,input:document.getElementById('asset-prompt')});
     if(disposed||generation!==epoch||!visible){await value.dispose();return;}
     renderer=value;renderedKey=key;lastError=null;
    }catch(error){if(error.name!=='AbortError'){lastError=error.message;status.textContent=`Kiln unavailable: ${lastError}`;tile.dataset.state='unavailable';}return;}
   }
   if(generation!==epoch)return;
   await renderer.setActive(running);
   status.textContent='';tile.dataset.state=running?'burning':'idle';
  }).catch(error=>{lastError=error.message;status.textContent=`Kiln unavailable: ${lastError}`;tile.dataset.state='unavailable';});
  return lifecycle;
 }
 function render(state){
  renderer?.syncEditor?.();
  const active=['loading','running','stopping'].includes(state?.status),next=state?.request??null;
  const changed=active!==running||(active&&next?.id!==request?.id);request=next;running=active;
  // An active request is visible in simple consumers without an observer. The
  // actual Generate pane explicitly supplies visibility, including when hidden.
  if(changed){if(!active){allowCold=refreshPending;if(refreshPending)renderedKey=null;refreshPending=false;epoch++;abort();}sync();}
 }
 return {render,element:tile,
  setVisible(value){if(visible===!!value)return lifecycle;visible=!!value;if(visible)allowCold=true;tile.hidden=!visible;return sync();},
  refresh(){allowCold=true;if(running){refreshPending=true;return lifecycle;}renderedKey=null;return sync({refresh:true});},
  read:()=>({running,error:lastError,visible,renderer:renderer?.debugState?.()??null}),
  async dispose(){disposed=true;visible=false;epoch++;abort();await sync();tile.remove();},
 };
}
