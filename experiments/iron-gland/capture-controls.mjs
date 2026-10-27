export function captureInstructions(c) {
  if(c.status!=='recording'||c.error||!c.cue)return {current:null,next:null};
  if(c.protocolComplete)return {current:{title:'Sequence complete',detail:'Rest your hand. Finish the take when you are comfortable.',complete:true},next:null};
  const remaining=Math.max(0,c.cue.seconds-c.cue.elapsedSeconds);
  return {current:{...c.cue,paused:c.paused,seconds:Math.ceil(remaining),progress:Math.min(1,c.cue.elapsedSeconds/c.cue.seconds)},
    next:c.nextCue?{...c.nextCue,seconds:Math.ceil(remaining),paused:c.paused}:null};
}

export function mountCaptureControls({root,document,invoke,read}) {
  const section=document.createElement('section');section.dataset.ironCapture='';
  const layout=document.createElement('style');
  layout.textContent=`
    body:has([data-iron-capture]) #viewport :is(#navigation-hint,#scene-edit-hud,#info-bar) { display:none; }
    @media(max-width:800px) {
      body.has-authoring-workspace.experiment-workspace[data-workspace=workbench]:has([data-iron-capture]) {
        height:auto;min-height:100vh;overflow:auto;
        grid-template-columns:minmax(0,1fr);
        grid-template-rows:42px minmax(620px,calc(100dvh - 42px)) auto auto;
      }
      body:has([data-iron-capture]) #experiment-instruments { grid-column:1;grid-row:3;max-height:none;overflow:visible; }
      body.experiment-workspace.has-workbench-inspector:has([data-iron-capture]) #authoring-right { grid-column:1;grid-row:4;height:320px; }
    }`;
  section.append(layout);
  section.style.cssText='border-top:1px solid #465051;margin-top:14px;padding-top:14px;letter-spacing:0;min-width:0';
  const heading=document.createElement('h3');heading.textContent='Gesture capture';heading.style.cssText='font-size:16px;margin:0 0 10px';
  const modes=document.createElement('fieldset');modes.setAttribute('aria-label','Capture mode');
  modes.style.cssText='display:flex;gap:12px;flex-wrap:wrap;border:0;padding:0;margin:0 0 10px;min-width:0';
  const choices=[];let mode='neutral';
  for(const [value,text] of [['neutral','Carry · 1 min'],['turns','Turns · 3 min']]){
    const option=document.createElement('label');option.style.cssText='display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer';
    const input=document.createElement('input');input.type='radio';input.name='iron-capture-mode';input.value=value;input.checked=value===mode;
    input.style.cssText='margin:0;accent-color:#64e0d6';input.setAttribute('aria-label',value==='neutral'?'Neutral':'Turns');
    input.onchange=()=>{if(input.checked){mode=value;name.placeholder=value==='neutral'?'Comfortable carry':'Comfortable turns';}};
    const caption=document.createElement('span');caption.textContent=text;option.append(input,caption);modes.append(option);choices.push(input);
  }
  const label=document.createElement('label');label.textContent='Take name';label.style.cssText='display:grid;gap:5px;margin:8px 0';
  const name=document.createElement('input');name.type='text';name.placeholder='Comfortable carry';name.setAttribute('aria-label','Take name');
  name.style.cssText='box-sizing:border-box;width:100%;min-width:0;height:32px;padding:5px 8px;background:#202629;color:#e4eeec;border:1px solid #465051;border-radius:3px';label.append(name);
  const buttons=document.createElement('div');buttons.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin:10px 0';
  const status=document.createElement('div');status.setAttribute('role','status');status.style.cssText='font-size:12px;overflow-wrap:anywhere;line-height:1.5';
  const path=document.createElement('output');path.style.cssText='display:block;font-size:11px;overflow-wrap:anywhere;color:#abb9bd;margin-top:7px';
  let failure=null;
  const run=(operation,args)=>invoke(operation,args).catch(error=>{failure=String(error.message??error);update();});
  const button=(text,title,action)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.title=title;b.setAttribute('aria-label',title);b.onclick=action;buttons.append(b);return b;};
  const start=button('Record take','Record take',()=>{failure=null;run('beginCapture',{label:name.value,mode});});
  const finish=button('Finish take','Finish and save this take',()=>run('finishCapture'));
  const pause=button('\u23f8','Pause instructions',()=>run('pauseCapture'));
  const repeat=button('\u21ba','Repeat this cue; keep previous data',()=>run('repeatCapture'));
  for(const b of [pause,repeat])b.style.cssText='width:34px;height:34px;padding:0;font-size:20px';
  section.append(heading,modes,label,buttons,status,path);root.append(section);

  const viewport=document.getElementById('viewport');
  const cue=document.createElement('section');cue.dataset.ironCaptureCue='';cue.setAttribute('aria-label','Current gesture instruction');
  cue.style.cssText='position:absolute;top:14px;left:14px;right:14px;margin:auto;max-width:650px;z-index:6;pointer-events:none;box-sizing:border-box;background:rgba(13,24,28,.94);border-bottom:2px solid #53d6ce;padding:12px 16px;color:#f1f7f6;letter-spacing:0';
  const top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#83d7d2';
  const step=document.createElement('span'),tag=document.createElement('span');top.append(step,tag);
  const row=document.createElement('div');row.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 64px;gap:12px;align-items:center';
  const copy=document.createElement('div'),title=document.createElement('h2'),detail=document.createElement('p'),count=document.createElement('strong');
  title.style.cssText='font-size:21px;line-height:1.18;margin:8px 0 5px;overflow-wrap:anywhere;color:#f1f7f6;letter-spacing:0';
  detail.style.cssText='font-size:13px;line-height:1.45;margin:0;overflow-wrap:anywhere;color:#c5d6db';
  count.style.cssText='font-size:38px;text-align:center;font-variant-numeric:tabular-nums';
  copy.append(title,detail);row.append(copy,count);
  const progress=document.createElement('progress');progress.max=1;progress.style.cssText='display:block;width:100%;height:5px;margin-top:12px;accent-color:#64e0d6';
  cue.append(top,row,progress);viewport?.append(cue);
  const upcoming=document.createElement('section');upcoming.dataset.ironCaptureNext='';upcoming.setAttribute('aria-label','Upcoming gesture instruction');
  upcoming.style.cssText='position:absolute;bottom:52px;left:14px;right:14px;margin:auto;max-width:650px;z-index:6;pointer-events:none;box-sizing:border-box;background:rgba(24,26,29,.94);border-top:2px solid #eebd7d;padding:12px 16px;color:#f1f7f6;letter-spacing:0';
  const nextTag=document.createElement('div'),nextTitle=document.createElement('h2'),nextDetail=document.createElement('p');
  nextTag.style.cssText='font-size:11px;color:#eebd7d';nextTitle.style.cssText=title.style.cssText;nextDetail.style.cssText=detail.style.cssText;
  upcoming.append(nextTag,nextTitle,nextDetail);viewport?.append(upcoming);
  function update() {
    const state=read(),c=state.capture,active=['starting','recording','saving'].includes(c.status);
    start.disabled=!state.running||active;finish.disabled=c.status!=='recording';pause.disabled=repeat.disabled=c.status!=='recording';
    name.disabled=active;choices.forEach(input=>{input.disabled=active;});pause.textContent=c.paused?'\u25b6':'\u23f8';pause.title=c.paused?'Resume instructions':'Pause instructions';
    pause.setAttribute('aria-label',pause.title);
    const labels={idle:'No take recorded',starting:'Opening capture',recording:'Recording',saving:'Saving',complete:'Saved',partial:'Saved partial take',failed:'Capture failed'};
    status.textContent=failure??c.error??`${labels[c.status]}${c.frameCount?` · ${c.savedFrames}/${c.frameCount} observations saved`:''}${c.pending?` · ${c.pending} pending`:''}`;
    status.style.color=failure||c.error?'#ffb1a5':'#b7d9cf';path.textContent=c.path??'';
    const instructions=captureInstructions(state.running?c:{...c,status:'idle'}),item=instructions.current,next=instructions.next;
    cue.hidden=!item;upcoming.hidden=!next;
    // Clear hidden copy too: terminal states cannot leave stale instructions in the DOM.
    for(const element of [step,tag,title,detail,count,nextTag,nextTitle,nextDetail])element.textContent='';
    if(!cue.hidden){
      const toolbar=document.getElementById('authoring-viewport-tools');
      cue.style.top=`${(toolbar?.offsetHeight??0)+10}px`;
      title.style.textTransform='none';
      title.style.fontSize=viewport?.clientWidth<500?'16px':'21px';
      detail.style.fontSize=viewport?.clientWidth<500?'11px':'13px';
      cue.style.padding=viewport?.clientWidth<500?'8px 10px':'12px 16px';
      step.textContent=item.complete?'DONE':`NOW · ${item.index+1} / ${item.total}`;tag.textContent=c.paused?'INSTRUCTIONS PAUSED':'RECORDING';
      title.textContent=item.title;detail.textContent=item.detail;
      count.textContent=item.complete?'':c.paused?'\u2016':`${item.seconds}`;
      progress.value=item.complete?1:item.progress;
    }
    if(next){
      nextTag.textContent=next.paused?'NEXT · PAUSED':`NEXT · IN ${next.seconds} S`;
      nextTitle.textContent=next.title;nextDetail.textContent=next.detail;
      nextTitle.style.fontSize=viewport?.clientWidth<500?'15px':'19px';nextTitle.style.textTransform='none';
      nextDetail.style.fontSize=viewport?.clientWidth<500?'11px':'13px';
      upcoming.style.padding=viewport?.clientWidth<500?'8px 10px':'12px 16px';
    }
  }
  const visibility=()=>{if(document.hidden&&read().capture.status==='recording'&&!read().capture.paused)run('pauseCapture');};
  document.addEventListener('visibilitychange',visibility);
  update();
  return {update,dispose(){document.removeEventListener('visibilitychange',visibility);cue.remove();upcoming.remove();section.remove();}};
}
