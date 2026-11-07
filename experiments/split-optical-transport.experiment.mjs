import {splitIntegralSettings} from '../volume-split-integral.mjs';
export default {
 id:'split-optical-transport',title:'Retained optical contributions',
 async create({host,inputs={},record,updateInputs}){
  await host.volume?.ready;
  const session=await host.scene.open(),win=host.controls.document.defaultView,source=()=>win.__kaminosVolumePrototype;
  let options=splitIntegralSettings(inputs.optical??{}),panel,status,error=null,disposed=false;const drags=[];
  source().setSplitIntegral(options);
  const read=()=>({options,effective:source()?.debugState()?.splitIntegral??null,error,held:source()?.isIntegralEvaluationHeld?.()??false});
  const sync=()=>{if(disposed||!panel)return;const s=read();
   for(const el of panel.querySelectorAll('[data-optical]')){
    if(host.controls.document.activeElement!==el&&!el.classList.contains('scrubbing'))el.value=String(options[el.dataset.optical]);
    el.disabled=s.held||(el.dataset.optical==='fresh'&&options.mode==='split');el.style.opacity=el.disabled?'.4':'1';
   }
   const e=s.effective;
   status.textContent=error?`Unchanged: ${error}`:s.held?'Comparison holds its captured input. Resume the comparison to change retained contributions.':e?.effective&&e.effective!=='off'?`${e.freshEvaluations} fresh material evaluation${e.freshEvaluations===1?'':'s'} · 2 retained depth contributions · ${(e.bytes/1048576).toFixed(1)} MiB optical buffers. ${e.frames} draws. ${e.reset?'History reset for this camera/source.':''}`:`${options.mode==='off'?'Transport off.':'Select Fixed evaluations in the fire Quality inspector and enable the world field. '+(e?.reason??'Waiting for an ordinary flame draw.')}`;
  };
  const operations={setOptions(patch){const next=splitIntegralSettings({...options,...patch});source().setSplitIntegral(next);options=next;error=null;updateInputs({optical:options});record({kind:'optical-transport.policy',options});sync();session.redraw();return read();},reset(){source().setSplitIntegral({mode:'off'});source().setSplitIntegral(options);session.redraw();return read();}};
  const stop=session.onFrame(sync);
  return {read,operations,mount({root,document,invoke}){panel=root;
   const p=document.createElement('p');p.textContent='Keep two local optical observations and refresh only the chosen budget. Fine, middle and world flow move their source anchors; camera/source changes clear them. Light and extinction fade independently. This is an experimental rendering approximation.';root.append(p);
   const control=(label,key,choices,step=.1)=>{
    const row=document.createElement('label'),grip=document.createElement('span'),el=document.createElement(choices?'select':'input');grip.textContent=label;el.dataset.optical=key;el.className='transform-input';el.setAttribute('aria-label',label);
    if(choices)for(const [value,text] of choices){const o=document.createElement('option');o.value=String(value);o.textContent=text;el.append(o);}else{el.type='number';el.step='any';el.min='0';drags.push(host.controls.installNumberDrag({input:el,grip,step}));}
    el.addEventListener(choices?'change':'input',()=>{if(!el.value.trim())return;const value=key==='mode'?el.value:Number(el.value);if(typeof value==='number'&&!Number.isFinite(value))return;invoke('setOptions',{[key]:value}).catch(e=>{error=e.message;sync();});});
    row.style.cssText='display:grid;grid-template-columns:1fr 9rem;align-items:center;gap:10px;margin:10px 0';el.style.width='100%';row.append(grip,el);root.append(row);
   };
   control('Optical contributions','mode',[['off','Off'],['split','Fresh split · 2 evaluations'],['transport','Retain + refresh']]);
   control('Fresh evaluations','fresh',[[1,'1 per pixel'],[2,'2 per pixel']]);
   control('Light lifetime (draws)','memory',null,.25);control('Opacity lifetime (draws)','opacityMemory',null,.25);
   control('Refresh response','response',null,.05);control('Exploration fraction','exploration',null,.05);
   control('Flow transport','motion',null,.1);control('Anchor footprint (px)','footprint',null,.25);
   const note=document.createElement('p');note.textContent='Fresh split recomposes the existing two-evaluation fixed march. Retain + refresh with one fresh evaluation explores new depths and rechecks old anchors. Response 1 replaces a rechecked observation immediately; lower values preserve it through weak refreshes. Lifetimes affect old observations only. Ordinary Spatial reconstruction can follow; Image temporal is a separate additional filter.';root.append(note);
   status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='font-size:12px;line-height:1.6;color:#b2c6d2';root.append(status);sync();
  },async dispose(){disposed=true;stop();drags.forEach(d=>d?.dispose?.());source()?.setSplitIntegral({mode:'off'});await session.dispose();}};
 }
};
