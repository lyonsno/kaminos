// The backend owns both live simulations and presentation. History is immutable
// render data; scrubbing never restores or advances the live solvers backwards.
export async function createPairedFluidPlayback({backend,record=()=>{},changed=()=>{}}){
 let closed=false,playing=false,busy=false,failure=null,selected=0,frames=[],chain=Promise.resolve(),lastNow=null,credit=0,endStep=null,rate=1,epoch=0;
 const initial=backend.read();
 if(initial.length!==2||!Number.isFinite(backend.dt)||backend.dt<=0||initial.some(a=>a.step!==0||a.dt!==backend.dt))throw Error('Pair requires two initial states with the same fixed physics timestep');
 const identities=initial.map(a=>({id:a.id,generation:a.generation}));
 const actual=()=>{const arms=backend.read();if(arms.length!==2||arms.some((a,i)=>a.id!==identities[i].id||a.generation!==identities[i].generation||a.dt!==backend.dt))throw Error('Paired water identity changed');return arms;};
 const aligned=arms=>arms[0].step===arms[1].step;
 const read=()=>{const arms=actual();if(arms.some(a=>a.failure)){failure=arms.find(a=>a.failure).failure;playing=false;}return{kind:'paired-fluid-render-history',step:selected,timeSeconds:selected*backend.dt,dt:backend.dt,playing,busy,rate,endStep,retainedFrames:frames.length,recordedEndStep:frames.length-1,historyBytes:arms.reduce((n,a)=>n+(a.history?.bytes??0),0),historyLifetime:'current experiment',simulationCheckpoint:false,arms,aligned:aligned(arms),failure};};
 const event=(phase,requested)=>record({kind:'fluid.pair.transport',phase,target:'water-pair',requested,effective:read()});
 const notify=()=>changed(read());
 function pause(){playing=false;lastNow=null;credit=0;epoch++;if(!closed)notify();return closed?null:read();}
 async function move(step,requestEpoch){
  if(closed)throw Error('Paired playback disposed');if(failure)throw Error('Pair stopped after failure: '+failure);
  if(!Number.isSafeInteger(step)||step<0)throw Error('Pair frame must be a nonnegative safe integer');
  if(requestEpoch!==epoch)return read();
  busy=true;event('requested',{step});notify();
  try{
   while(frames.length<=step){
    if(closed)throw Error('Paired playback disposed');
    for(let i=0;i<2;i++)await backend.advance(i);
    const arms=actual();if(!aligned(arms)||arms[0].step!==frames.length)throw Error('Pair did not reach the same requested physical time');
    frames.push(await backend.capture());
    selected=frames.length-1;backend.show(frames[selected]);notify();
    if(requestEpoch!==epoch){event('interrupted',{step});return read();}
   }
   selected=step;backend.show(frames[selected]);event('applied',{step});return read();
  }catch(error){failure=error.message;playing=false;event('failed',{step});throw error;}
  finally{busy=false;notify();}
 }
 const enqueue=step=>{const requestEpoch=epoch,task=chain.then(()=>move(step,requestEpoch));chain=task.catch(()=>{});return task;};
 frames.push(await backend.capture());backend.show(frames[0]);
 return{read,seek(step){pause();return enqueue(step);},
  play({endStep:target=frames.length-1,rate:value=1}={}){
   if(closed||failure)throw Error('Paired playback unavailable');if(!Number.isSafeInteger(target)||target<=selected)throw Error('Playback endpoint must follow the current frame');
   if(!Number.isFinite(value)||value<=0)throw Error('Playback rate must be positive');
   epoch++;endStep=target;rate=value;playing=true;lastNow=null;credit=0;event('applied',{play:true,endStep,rate});notify();return read();
  },pause,
  async tick(now){
   if(!playing||busy||closed)return read();if(lastNow===null){lastNow=now;return read();}
   credit+=(now-lastNow)/1000*rate;lastNow=now;const steps=Math.floor((credit+1e-10)/backend.dt);
   if(!steps)return read();credit-=steps*backend.dt;
   await enqueue(Math.min(endStep,selected+steps));if(selected>=endStep)pause();return read();
  },async dispose(){if(closed)return;pause();await chain;closed=true;await backend.dispose();frames=[];},
 };
}
