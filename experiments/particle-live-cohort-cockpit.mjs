export function createLiveCohortCockpit({runtime,session,document,record,playback,setPaused}) {
 const viewport=document.getElementById('viewport');
 let armed=false,pointer=null,ui=null,lastPick=null,suppressClick=false,resumeOnCancel=false;
 function state(){return runtime().opticalParticleState().liveCohort??{view:'off',phase:'off'};}
 function update(){
  if(!ui)return;
  const current=state();
  ui.view.disabled=armed||current.view==='off';
  ui.view.value=current.view;
  ui.reseed.disabled=armed||!lastPick;
  ui.pick.textContent=armed?'Cancel seed pick':'Pick a seed';
  const point=current.projectedSeed;
  ui.marker.hidden=armed||!point||point.some(v=>Math.abs(v)>1);
  if(!ui.marker.hidden){
   ui.marker.style.left=`${50*(1+point[0])}%`;
   ui.marker.style.top=`${50*(1-point[1])}%`;
  }
  const outside=point?.some(v=>Math.abs(v)>1);
  const clock=playback().paused?' Held. Use Play to follow it.':'';
  ui.status.textContent=armed?'Flame held. Click a visible sparse carrier.':
   current.phase==='tracking'?counts(current)+(outside?' The seed moved out of view.':'')+clock:
   current.phase==='seed-lost'?counts(current)+' The seed expired. The original survivors are still available.':
   current.phase==='no-seed'?'No eligible seed near that point. Use Normal view to find one, or play and reseed here.':
   current.phase==='pending'?'Reading the live neighborhood…':
   current.phase==='expired'?'The carrier pool changed. Pick a seed in the current flame.':
   current.phase==='unavailable'?current.reason:'Pick a seed to compare its original neighbors with its current neighbors.';
 }
 function counts(c){
  return `Step ${c.step} · picked at ${c.acquisitionStep}. `+
   `Original ${c.original} (${c.emittingOriginal} emitting, ${c.extinctiveOriginal} with extinction). `+
   `Fresh ${c.fresh} (${c.emittingFresh} emitting, ${c.extinctiveFresh} with extinction). Shared ${c.overlap}.`;
 }
 function inspect(request){
  const next=runtime().setOpticalParticleLiveCohort(request);
  record?.({kind:'particle.source-cohort',request});
  session.redraw();
  return next;
 }
 function setLiveCohortView({view}){
  armed=false;
  if(view!=='off'&&state().view==='off')throw Error('Pick a seed first');
  const next=inspect({view});
  update();return next;
 }
 function acquire(pick,view){
  armed=false;
  if(!playback().paused)setPaused(true);
  const next=inspect({view,pick});
  lastPick=structuredClone(pick);
  update();return next;
 }
 function pickLiveCohort({point,pixelScale,radiusPixels=18}){
  return acquire({point,pixelScale,radiusPixels},'original');
 }
 function reseedLiveCohort(){
  if(!lastPick)throw Error('Pick a seed first');
  const rect=viewport?.getBoundingClientRect();
  const pick=rect?.width&&rect?.height?{...lastPick,pixelScale:[rect.width/2,rect.height/2]}:lastPick;
  const view=state().view==='fresh'?'fresh':'original';
  return acquire(pick,view);
 }
 function consume(event){
  event.preventDefault();
  event.stopImmediatePropagation();
 }
 function onDown(event){
  suppressClick=false;
  if(!armed||pointer||event.button!==0||event.isPrimary===false||
     event.target.closest?.('button,input,select,textarea,a,[role=button]'))return;
  pointer=[event.clientX,event.clientY,event.pointerId];
  viewport.setPointerCapture?.(event.pointerId);
  consume(event);
 }
 function onCancel(event){
  if(!pointer||event.pointerId!==pointer[2])return;
  pointer=null;
  if(event.type==='pointercancel')consume(event);
 }
 function onClick(event){
  if(suppressClick&&event.detail!==0){suppressClick=false;consume(event);}
 }
 function onUp(event){
  if(!pointer||event.pointerId!==pointer[2])return;
  const distance=Math.hypot(event.clientX-pointer[0],event.clientY-pointer[1]);
  pointer=null;
  suppressClick=true;
  consume(event);
  if(!armed||distance>4)return;
  const r=viewport.getBoundingClientRect();
  if(!r.width||!r.height)return;
  const point=[2*(event.clientX-r.left)/r.width-1,1-2*(event.clientY-r.top)/r.height];
  void ui.invoke('pickLiveCohort',{point,pixelScale:[r.width/2,r.height/2]}).catch(error=>{
   armed=false;update();ui.status.textContent=error.message;
  });
 }
 const listeners={pointerdown:onDown,pointerup:onUp,pointercancel:onCancel,lostpointercapture:onCancel,click:onClick};
 return {
  update, operations:{setLiveCohortView,pickLiveCohort,reseedLiveCohort},
  mount(root,invoke){
   const pick=document.createElement('button'), reseed=document.createElement('button'),view=document.createElement('select'), status=document.createElement('p');
   pick.type=reseed.type='button';
   reseed.textContent='Reseed here';
   reseed.title='Hold the flame and acquire a new cohort around the last viewport click.';
   view.setAttribute('aria-label','Source cohort view');
   for(const [value,label] of [['off','Normal view'],['original','Original members'],['fresh','Fresh neighborhood']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;view.append(option);
   }
   pick.addEventListener('click',()=>{
    if(armed){
     armed=false;
     if(resumeOnCancel)setPaused(false);
    }else{
     resumeOnCancel=!playback().paused;
     if(resumeOnCancel)setPaused(true);
     armed=true;
    }
    update();
   });
   reseed.addEventListener('click',()=>void invoke('reseedLiveCohort').catch(error=>{status.textContent=error.message;}));
   view.addEventListener('change',()=>void invoke('setLiveCohortView',{view:view.value}).catch(error=>{
    update();status.textContent=error.message;
   }));
   status.dataset.sourceCohortStatus='';
   status.style.margin='8px 0 0';
   root.append(pick,reseed,view,status);
   const marker=document.createElement('span');
   marker.style.cssText='position:absolute;z-index:6;pointer-events:none;width:13px;height:13px;'+
    'transform:translate(-50%,-50%);border:1px solid white;border-radius:50%;box-shadow:0 0 0 1px #202124;';
   marker.setAttribute('aria-hidden','true');
   viewport?.append(marker);
   ui={pick,reseed,view,status,marker,invoke};
   for(const [name,handler] of Object.entries(listeners))viewport?.addEventListener(name,handler,true);
   update();
  },
  dispose(){
   for(const [name,handler] of Object.entries(listeners))viewport?.removeEventListener(name,handler,true);
   ui?.marker.remove();
   if(ui)try{runtime().setOpticalParticleLiveCohort({view:'off'});}catch{}
   ui=null;
  },
 };
}
