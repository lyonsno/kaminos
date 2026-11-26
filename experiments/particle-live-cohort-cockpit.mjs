export function createLiveCohortCockpit({runtime,session,document,record}) {
 const viewport=document.getElementById('viewport');
 let armed=false,pointer=null,ui=null;
 function state(){return runtime().opticalParticleState().liveCohort??{view:'off',phase:'off'};}
 function update(){
  if(!ui)return;
  const current=state();
  ui.view.disabled=armed||current.view==='off';
  ui.view.value=current.view;
  ui.pick.textContent=armed?'Cancel seed pick':'Pick a seed';
  const point=current.projectedSeed;
  ui.marker.hidden=armed||!point||point.some(v=>Math.abs(v)>1);
  if(!ui.marker.hidden){
   ui.marker.style.left=`${50*(1+point[0])}%`;
   ui.marker.style.top=`${50*(1-point[1])}%`;
  }
  ui.status.textContent=armed?'Click a visible sparse carrier in the flame.':
   current.phase==='tracking'?counts(current):
   current.phase==='seed-lost'?counts(current)+' The seed expired. The original survivors are still available.':
   current.phase==='no-seed'?'No eligible seed near that point. Pick a visible carrier.':
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
  armed=false;pointer=null;
  if(view!=='off'&&state().view==='off')throw Error('Pick a seed first');
  const next=inspect({view});
  update();return next;
 }
 function pickLiveCohort({point,pixelScale,radiusPixels=18}){
  armed=false;pointer=null;
  const next=inspect({view:'original',pick:{point,pixelScale,radiusPixels}});
  update();return next;
 }
 function onDown(event){
  if(armed&&event.button===0)pointer=[event.clientX,event.clientY,event.pointerId];
 }
 function onUp(event){
  if(!armed||!pointer||event.pointerId!==pointer[2])return;
  const distance=Math.hypot(event.clientX-pointer[0],event.clientY-pointer[1]);
  pointer=null;
  if(distance>4)return;
  const r=viewport.getBoundingClientRect();
  if(!r.width||!r.height)return;
  event.preventDefault();event.stopImmediatePropagation();
  const point=[2*(event.clientX-r.left)/r.width-1,1-2*(event.clientY-r.top)/r.height];
  void ui.invoke('pickLiveCohort',{point,pixelScale:[r.width/2,r.height/2]}).catch(error=>{
   armed=false;update();ui.status.textContent=error.message;
  });
 }
 return {
  update, operations:{setLiveCohortView,pickLiveCohort},
  mount(root,invoke){
   const pick=document.createElement('button'), view=document.createElement('select'), status=document.createElement('p');
   pick.type='button';
   view.setAttribute('aria-label','Source cohort view');
   for(const [value,label] of [['off','Normal view'],['original','Original members'],['fresh','Fresh neighborhood']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;view.append(option);
   }
   pick.addEventListener('click',()=>{armed=!armed;pointer=null;update();});
   view.addEventListener('change',()=>void invoke('setLiveCohortView',{view:view.value}).catch(error=>{
    update();status.textContent=error.message;
   }));
   status.dataset.sourceCohortStatus='';
   status.style.margin='8px 0 0';
   root.append(pick,view,status);
   const marker=document.createElement('span');
   marker.style.cssText='position:absolute;z-index:6;pointer-events:none;width:13px;height:13px;'+
    'transform:translate(-50%,-50%);border:1px solid white;border-radius:50%;box-shadow:0 0 0 1px #202124;';
   marker.setAttribute('aria-hidden','true');
   viewport?.append(marker);
   ui={pick,view,status,marker,invoke};
   viewport?.addEventListener('pointerdown',onDown,true);
   viewport?.addEventListener('pointerup',onUp,true);
   update();
  },
  dispose(){
   viewport?.removeEventListener('pointerdown',onDown,true);
   viewport?.removeEventListener('pointerup',onUp,true);
   ui?.marker.remove();
   if(ui)try{runtime().setOpticalParticleLiveCohort({view:'off'});}catch{}
   ui=null;
  },
 };
}
