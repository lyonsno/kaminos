export function mountCaptureControls({root,document,invoke,read,tick}) {
  const section=document.createElement('section');section.dataset.ironCapture='';
  section.style.cssText='border-top:1px solid #465051;margin-top:14px;padding-top:14px;letter-spacing:0;min-width:0';
  const heading=document.createElement('h3');heading.textContent='Gesture capture';heading.style.cssText='font-size:16px;margin:0 0 10px';
  const label=document.createElement('label');label.textContent='Take name';label.style.cssText='display:grid;gap:5px;margin:8px 0';
  const name=document.createElement('input');name.type='text';name.placeholder='Comfortable turns';name.setAttribute('aria-label','Take name');
  name.style.cssText='box-sizing:border-box;width:100%;min-width:0;height:32px;padding:5px 8px;background:#202629;color:#e4eeec;border:1px solid #465051;border-radius:3px';label.append(name);
  const buttons=document.createElement('div');buttons.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin:10px 0';
  const status=document.createElement('div');status.setAttribute('role','status');status.style.cssText='font-size:12px;overflow-wrap:anywhere;line-height:1.5';
  const path=document.createElement('output');path.style.cssText='display:block;font-size:11px;overflow-wrap:anywhere;color:#abb9bd;margin-top:7px';
  let failure=null;
  const run=(operation,args)=>invoke(operation,args).catch(error=>{failure=String(error.message??error);update();});
  const button=(text,title,action)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.title=title;b.setAttribute('aria-label',title);b.onclick=action;buttons.append(b);return b;};
  const start=button('Record take','Record take',()=>{failure=null;run('beginCapture',{label:name.value});});
  const finish=button('Finish take','Finish and save this take',()=>run('finishCapture'));
  const pause=button('\u23f8','Pause instructions',()=>run('pauseCapture'));
  const repeat=button('\u21ba','Repeat this cue; keep previous data',()=>run('repeatCapture'));
  for(const b of [pause,repeat])b.style.cssText='width:34px;height:34px;padding:0;font-size:20px';
  section.append(heading,label,buttons,status,path);root.append(section);

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
  function update() {
    const state=read(),c=state.capture,active=['starting','recording','saving'].includes(c.status);
    start.disabled=!state.running||active;finish.disabled=c.status!=='recording';pause.disabled=repeat.disabled=c.status!=='recording';
    name.disabled=active;pause.textContent=c.paused?'\u25b6':'\u23f8';pause.title=c.paused?'Resume instructions':'Pause instructions';
    pause.setAttribute('aria-label',pause.title);
    const labels={idle:'No take recorded',starting:'Opening capture',recording:'Recording',saving:'Saving',complete:'Saved',partial:'Saved partial take',failed:'Capture failed'};
    status.textContent=failure??c.error??`${labels[c.status]}${c.frameCount?` · ${c.savedFrames}/${c.frameCount} observations saved`:''}${c.pending?` · ${c.pending} pending`:''}`;
    status.style.color=failure||c.error?'#ffb1a5':'#b7d9cf';path.textContent=c.path??'';
    cue.hidden=c.status!=='recording';
    if(!cue.hidden){
      const toolbar=document.getElementById('authoring-viewport-tools');
      cue.style.top=`${(toolbar?.offsetHeight??0)+10}px`;
      title.style.textTransform='none';
      title.style.fontSize=viewport?.clientWidth<500?'16px':'21px';
      detail.style.fontSize=viewport?.clientWidth<500?'11px':'13px';
      cue.style.padding=viewport?.clientWidth<500?'8px 10px':'12px 16px';
      const item=c.cue;step.textContent=`${item.index+1} / ${item.total}`;tag.textContent=c.paused?'INSTRUCTIONS PAUSED':'RECORDING';
      title.textContent=c.protocolComplete?'Sequence complete':item.title;
      detail.textContent=c.protocolComplete?'Rest your hand. Finish the take when you are comfortable.':item.detail;
      const remaining=Math.max(0,item.seconds-item.elapsedSeconds);
      count.textContent=c.paused?'\u2016':c.protocolComplete?'':item.intent==='countdown'?String(Math.ceil(remaining)):String(Math.min(item.seconds,Math.floor(item.elapsedSeconds)+1));
      progress.value=Math.min(1,item.elapsedSeconds/item.seconds);
    }
  }
  const interval=document.defaultView.setInterval(()=>{tick();update();},100);
  const visibility=()=>{if(document.hidden&&read().capture.status==='recording'&&!read().capture.paused)run('pauseCapture');};
  document.addEventListener('visibilitychange',visibility);
  update();
  return {update,dispose(){document.defaultView.clearInterval(interval);document.removeEventListener('visibilitychange',visibility);cue.remove();section.remove();}};
}
