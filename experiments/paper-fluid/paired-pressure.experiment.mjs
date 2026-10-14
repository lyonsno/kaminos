import {pressureLaunchSetup,DERIVED_MAIN_COMPLIANCE} from './pressure-launch.mjs';
import {createPairedFluidPlayback} from '../../paired-fluid-playback.mjs';

export default{id:'paper/paired-pressure',title:'Paired water · pressure compliance',
 async create({host,inputs={},record}){
  if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||Object.keys(inputs).some(k=>k!=='compliance'))throw Error('Paired pressure accepts only candidate compliance');
  let compliance=inputs.compliance??DERIVED_MAIN_COMPLIANCE,backend,player,sceneSession,unsubscribe,mounted=null,closed=false,transition=null,pendingReset=null;
  const doc=host.controls.document,win=doc.defaultView;
  async function start(value){
   const setups=[pressureLaunchSetup({compliance:0}),pressureLaunchSetup({compliance:value})];
   backend=await host.fluid.openPair(setups);
   player=await createPairedFluidPlayback({backend,record,changed:state=>mounted?.update(transition?read():state)});
   unsubscribe=backend.onFrame(({timestampMs})=>{player.tick(timestampMs).catch(error=>mounted?.error(error));});
  }
  try{sceneSession=await host.scene.open();await start(compliance);}
  catch(error){await backend?.dispose();await sceneSession?.dispose();throw error;}
  const read=()=>transition?{...transition.previous,status:transition.phase,readAuthority:'retained-before-reset',busy:transition.phase==='resetting',playing:false,failure:transition.failure??null,requestedCompliance:transition.requested}:({...player.read(),status:'live',readAuthority:'live-pair',candidateCompliance:compliance,host:backend.state(),view:sceneSession.readView(),question:'Does finite pressure compliance improve the drop through impact?',purpose:'Same water, radius, timestep and four passes. Surface force and artificial damping off. Diagnostic comparison; no accepted water preset.'});
  const live=()=>{if(closed||transition||!player)throw Error('Water comparison unavailable: '+(transition?.phase??'disposed'));return player;};
  function reset(value=compliance){
   if(closed)throw Error('Water comparison disposed');if(pendingReset)throw Error('Water reset already in progress');
   pressureLaunchSetup({compliance:value});transition={phase:'resetting',previous:read(),requested:value};mounted?.update(read());
   pendingReset=(async()=>{
    unsubscribe?.();unsubscribe=null;
    try{
     await player?.dispose();player=null;backend=null;compliance=value;await start(compliance);
     if(closed)throw Error('Water comparison disposed during reset');
     transition=null;mounted?.update(player.read());return read();
    }catch(error){
     unsubscribe?.();unsubscribe=null;await player?.dispose();player=null;await backend?.dispose();backend=null;
     transition={...transition,phase:'failed-reset',failure:error.message};mounted?.update(read());throw error;
    }finally{pendingReset=null;}
   })();return pendingReset;
  }
  return{read,operations:{
   seek:step=>live().seek(step),step:()=>live().seek(player.read().step+1),pause:()=>{player?.pause();return read();},
   play({seconds=2,rate=1}={}){const s=live().read();if(!Number.isFinite(seconds)||seconds<=s.timeSeconds)throw Error('End time must follow current time');return player.play({endStep:Math.round(seconds/s.dt),rate});},
   reset:({compliance:value=compliance}={})=>reset(value),
   frame(){sceneSession.setView({position:[-3.5,3.6,7],target:[-.7,1.5,.4],up:[0,1,0]});return read();},
  },async mount({root,document,invoke}){
   if(mounted)throw Error('Paired controls already mounted');
   let style=null,panel=null,labels=null,releaseTransport=null,uiDisposed=false;
   const listeners=[],priorClasses=new Map(['paired-fluid-comparison','pair-show-inspector'].map(name=>[name,document.body.classList.contains(name)]));
   const dispose=()=>{if(uiDisposed)return;uiDisposed=true;const errors=[];for(const remove of [()=>releaseTransport?.(),...listeners.splice(0),()=>panel?.remove(),()=>labels?.remove(),()=>style?.remove(),...Array.from(priorClasses,([name,had])=>()=>document.body.classList[had?'add':'remove'](name))])try{remove();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Paired UI cleanup failed');};
   mounted={dispose,update(){},error(){}};
   try{
   style=document.createElement('link');style.rel='stylesheet';style.href='/experiments/paper-fluid/paired-pressure.css';document.head.append(style);document.body.classList.add('paired-fluid-comparison');
   panel=document.createElement('section');panel.className='pair-settings';panel.innerHTML='<h3>Pressure comparison</h3><p>Left: hard pressure · compliance 0<br>Right: finite pressure · candidate below</p><label>Candidate compliance<input type="number" min="0" step="any" aria-label="Candidate compliance"></label><button type="button" class="btn" data-action="reset">Apply & reset both</button><p>Same 1,209 particles, water amount, radius 0.125, four passes and timestep 1/60. Surface force and artificial damping off.</p><p>Scrub recorded frames and orbit either view. Play extends the recording to the selected end time.</p><p class="pair-history-note">History lives in this experiment. Reset starts a new run. It is render history, not a solver checkpoint.</p>';
   const coefficient=panel.querySelector('input');coefficient.value=String(compliance);root.append(panel);
   const bar=document.createElement('div');bar.className='pair-transport';bar.innerHTML='<button type="button" class="btn" data-action="play">Play both</button><button type="button" class="btn" data-action="pause">Pause</button><button type="button" class="btn" data-action="step">Step both</button><label class="pair-timeline"><span>0.000 s</span><input type="range" min="0" max="0" value="0" step="1" aria-label="Scrub both water runs"></label><label>End (s)<input type="number" value="2" min="0" step="any" aria-label="Playback end time"></label><label>Speed<input type="number" value="1" min="0" step="any" aria-label="Playback speed"></label><button type="button" class="btn" data-action="frame">Frame</button><button type="button" class="btn" data-action="inspector">Scene</button><output aria-live="polite"></output>';
   releaseTransport=host.controls.mountTransport(bar);
   const slider=bar.querySelector('input[type=range]'),time=bar.querySelector('.pair-timeline span'),output=bar.querySelector('output'),end=bar.querySelector('[aria-label="Playback end time"]'),speed=bar.querySelector('[aria-label="Playback speed"]');
   labels=document.createElement('div');labels.className='pair-pane-labels';labels.innerHTML='<span>Hard pressure · 0</span><span>Finite compliance</span>';document.getElementById('viewport').append(labels);
   const listen=(node,name,fn)=>{node.addEventListener(name,fn);listeners.push(()=>node.removeEventListener(name,fn));};
   for(const [input,step]of [[coefficient,.1],[end,.1],[speed,.05]]){const drag=host.controls.installNumberDrag({input,step});listeners.push(()=>drag.stop());}
   const act=async(operation,input)=>{try{await invoke(operation,input);}catch(error){output.textContent=error.message;}};
   for(const button of [...panel.querySelectorAll('button'),...bar.querySelectorAll('button')])listen(button,'click',()=>{
    const action=button.dataset.action;
    if(action==='inspector'){document.body.classList.toggle('pair-show-inspector');win._kaminosDirty?.();return;}
    const input=action==='play'?{seconds:Number(end.value),rate:Number(speed.value)}:action==='reset'?{compliance:Number(coefficient.value)}:undefined;act(action,input);
   });
   listen(slider,'input',()=>act('seek',Number(slider.value)));
   const inactive=()=>{if(!transition)player?.pause();};listen(win,'blur',inactive);listen(document,'visibilitychange',()=>{if(document.hidden)inactive();});
   mounted={update(s){slider.max=String(s.recordedEndStep);slider.value=String(s.step);time.textContent=s.timeSeconds.toFixed(3)+' s';labels.lastChild.textContent='Finite compliance · '+compliance.toPrecision(5);output.textContent=s.failure?'Stopped: '+s.failure:s.status==='resetting'?'Resetting both water runs…':s.busy?'Advancing both…':`${s.playing?'Playing':'Paused'} · ${s.retainedFrames} frames · ${(s.historyBytes/1048576).toFixed(1)} MB`;},error(error){if(!transition)player?.pause();output.textContent=error.message;},dispose};
   mounted.update(player.read());await invoke('frame');return mounted;
   }catch(error){try{dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Paired mount and cleanup failed');}finally{mounted=null;}throw error;}
  },async dispose(){if(closed)return;closed=true;const errors=[];for(const cleanup of [()=>mounted?.dispose(),()=>pendingReset?.catch(()=>{}),()=>unsubscribe?.(),()=>player?.dispose(),()=>sceneSession.dispose()])try{await cleanup();}catch(error){errors.push(error);}mounted=null;if(errors.length)throw new AggregateError(errors,'Paired experiment cleanup failed');}};
 }};
