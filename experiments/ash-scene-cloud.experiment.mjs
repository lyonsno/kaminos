import localAsh from './ash-gpu-deposition.experiment.mjs';
import {atmosphereSettings} from '../ash/atmosphere-plan.mjs';
export default {id:'ash-scene-cloud',title:'Ash — across the scene',async create({host,inputs={},record}){
 const {atmosphere:settings={},...patchInputs}=inputs;
 const local=await localAsh.create({host,inputs:{cellSize:.03,...patchInputs},record});
 let atmosphere,session,disposed=false,paused=false,seconds=0,last=null;const drags=[];
 try{
  session=await host.scene.open();atmosphere=await host.atmosphere.open(settings);
  await session.attach(atmosphere.root,{owned:true,presentation:true,metadata:{label:'Fine ash across the scene',source:'ash:atmosphere',type:'experiment'}});
  session.onFrame(({timestampMs})=>{if(!paused&&last!==null)seconds+=(timestampMs-last)/1000;last=timestampMs;atmosphere.tick(seconds);session.redraw();});
  const read=()=>({...local.read(),atmosphere:atmosphere.read(),cloudPaused:paused});
  const operations={...local.operations,read,
   snapshot:async()=>({schema:'kaminos.scene-wide-ash.v1',local:await local.operations.snapshot(),atmosphere:atmosphere.read().settings,time:seconds,paused}),
   async restore(data){if(data?.schema!=='kaminos.scene-wide-ash.v1')return local.operations.restore(data);const next=atmosphereSettings(data.atmosphere);if(!Number.isFinite(data.time)||data.time<0||typeof data.paused!=='boolean')throw Error('Invalid ash cloud checkpoint');await local.operations.restore(data.local);atmosphere.set(next);seconds=data.time;paused=data.paused;atmosphere.tick(seconds);return read();},
   atmosphere(patch){const result=atmosphere.set(patch);record({kind:'ash.atmosphere',phase:'applied',effective:result});session.redraw();return read();},
   cloudTime(value){if(!Number.isFinite(value)||value<0)throw Error('Invalid cloud time');paused=true;seconds=value;atmosphere.tick(seconds);session.redraw();return read();},
   cloudPlay(value){if(typeof value!=='boolean')throw Error('Cloud playback requires Boolean');paused=!value;last=null;return read();},
   wide(){return session.setView({position:[6,3.4,8],target:[0,.7,0]});},
   renderProfile:async()=>{const renderer=host.scene.renderer();if(!renderer.backend.trackTimestamp)throw Error('Render timestamps not enabled on this route');const ms=await renderer.resolveTimestampsAsync('render');if(!Number.isFinite(ms))throw Error('Render timestamps unavailable');return {ms,scope:'Three last collected frame total render duration; flame canvas and ash raw compute excluded',drawingBuffer:[renderer.domElement.width,renderer.domElement.height]};},
   view:value=>value?session.setView(value):session.readView(),
   flame:async({presetId,controls}={})=>{const f=await host.flame.open();if(presetId)await f.applyBasin(presetId);if(controls)f.setControls(controls);return f.read();},
   listBasins:async()=>{const f=await host.flame.open();return f.listBasins();},
  };
  return {read,operations,mount(ctx){
   const {document,root,invoke}=ctx,section=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Ash across the scene';section.style.cssText='border:1px solid #444;padding:10px;margin:8px 0';section.append(legend);
   const text=document.createElement('p');text.textContent='Fine ash drifts through the whole view. Orbit through it; adjust its size, amount, haze and wind. The local source below adds retained material around the kiln.';section.append(text);
   const failed=error=>{status.textContent=error.message;};let status=document.createElement('p');status.setAttribute('role','status');
   const field=(label,key,value,step)=>{const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');row.style.cssText='display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px';grip.style.flex='1';input.style.width='90px';grip.textContent=label+' ';input.type='number';input.step='any';input.value=String(value);input.setAttribute('aria-label',label);input.className='transform-input';row.append(grip,input);section.append(row);drags.push(host.controls.installNumberDrag({input,grip,step}));input.addEventListener('input',()=>{const v=Number(input.value),patch=key==='wind'?{wind:[v,atmosphere.read().settings.wind[1],atmosphere.read().settings.wind[2]]}:{[key]:v};invoke('atmosphere',patch).catch(failed);});};
   const s=atmosphere.read().settings;field('Fine flakes','count',s.count,1000);field('Flake width','flakeSize',s.flakeSize,.001);field('Haze density','density',s.density,.002);field('Sideways drift','wind',s.wind[0],.01);
   const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=s.enabled;enabled.setAttribute('aria-label','Scene ash enabled');enabled.addEventListener('change',()=>invoke('atmosphere',{enabled:enabled.checked}).catch(failed));const label=document.createElement('label');label.append(enabled,' Scene ash');section.append(label);
   const button=document.createElement('button');button.textContent='Wide view';button.type='button';button.addEventListener('click',()=>invoke('wide').catch(failed));section.append(button,status);root.append(section);local.mount(ctx);
  },async dispose(){if(disposed)return;disposed=true;for(const drag of drags)drag?.dispose?.();atmosphere.dispose();await session.dispose();await local.dispose();}};
 }catch(error){atmosphere?.dispose();await session?.dispose();await local.dispose();throw error;}
}};
