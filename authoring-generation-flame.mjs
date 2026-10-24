// The Generate ceremony borrows the ordinary volume renderer. The paper effect
// is presentation; the source prompt stays editable and is retained in provenance.
export function installGenerationFlame({document,slot,createRenderer}){
  const tile=document.createElement('div');tile.className='generation-flame';tile.hidden=true;
  const volume=document.createElement('div');volume.className='generation-flame-volume';
  const paper=document.createElement('div');paper.className='generation-flame-paper';paper.setAttribute('aria-hidden','true');
  const card=document.createElement('canvas');card.className='generation-flame-card';card.hidden=true;card.setAttribute('aria-hidden','true');
  tile.append(volume,paper,card);slot.append(tile);
  let renderer=null,loading=null,startup=null,running=false,disposed=false,painted=null,lastError=null,paperPending=false,lifecycle=Promise.resolve();
  function sync(){
    lifecycle=lifecycle.catch(()=>{}).then(async()=>{
    if(disposed){renderer?.dispose();return;}
    if(running&&!renderer){
      if(!loading){startup=new AbortController();loading=createRenderer(volume,{signal:startup.signal}).then(value=>{renderer=value;return value;});}
      try{await loading;}catch(error){loading=null;if(error.name!=='AbortError'){lastError=error.message;tile.title=`Flame unavailable: ${lastError}`;tile.dataset.state='unavailable';}return;}
    }
    if(renderer){await renderer.setActive(running&&!disposed);if(!running)await renderer.setActive(false);else if(paperPending&&!disposed){paperPending=false;burnPaper();}if(disposed)renderer.dispose();}
    });return lifecycle;
  }
  function burnPaper(){paper.animate([
        {transform:'translateY(-22px) rotate(-5deg)',opacity:1,clipPath:'inset(0 0 0 0)',color:'#e8dcc5'},
        {offset:.5,transform:'translateY(8px) rotate(3deg)',opacity:1,clipPath:'inset(0 0 18% 0)',color:'#ffb04b'},
        {transform:'translateY(34px) rotate(7deg)',opacity:0,clipPath:'inset(0 0 100% 0)',color:'#402014'}
      ],{duration:2800,fill:'forwards',easing:'ease-in'});}
  function render(state){
    const active=['loading','running','stopping','saving'].includes(state?.status);
    if(active!==running){
      running=active;if(!active){startup?.abort();paperPending=false;}tile.hidden=!active;tile.dataset.state=active?'burning':'idle';
      if(active){paper.textContent=document.getElementById('asset-prompt')?.value||'';paper.getAnimations().forEach(a=>a.cancel());paperPending=true;card.hidden=true;painted=null;}
      sync().catch(error=>{lastError=error.message;tile.title=`Flame unavailable: ${lastError}`;});
    }
    const p=state?.preview;
    if(p&&p!==painted){card.width=p.width;card.height=p.height;card.getContext('2d').putImageData(new document.defaultView.ImageData(p.rgba,p.width,p.height),0,0);card.hidden=false;painted=p;}
  }
  return {render,read:()=>({running,error:lastError,renderer:renderer?.debugState?.()??null}),async dispose(){disposed=true;running=false;startup?.abort();await sync();tile.remove();}};
}
