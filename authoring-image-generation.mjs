// Page controls and legacy frame handoff. The operation is also imported directly by the worker host.
export * from "./authoring-image-operation.mjs";

// The volume prototype has one foreground requester. SF3D installs its own when it loads;
// klein borrows the kiln for its run and hands it back, so whichever model is running
// interleaves its duties with kiln frames.
export function createForegroundHandoff({prototype,host,waitFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())),settleMs=10000}){
  const requesters=new Map();let current=null;
  async function set(requester){
    const started=Date.now();
    for(;;){
      try{prototype.setForegroundOpportunityRequester(requester);return;}
      catch(error){
        // A kiln frame in flight refuses the swap; it settles within a frame or two.
        if(!/still pending/.test(error?.message)||Date.now()-started>settleMs)throw error;
        await waitFrame();
      }
    }
  }
  return {
    owner:()=>current,
    // A view of the prototype for a producer that installs its requester itself (SF3D).
    recording(owner){
      return new Proxy(prototype,{get(target,key){
        if(key==='setForegroundOpportunityRequester')return requester=>{target.setForegroundOpportunityRequester(requester);requesters.set(owner,requester);current=owner;};
        const value=target[key];return typeof value==='function'?value.bind(target):value;
      }});
    },
    install(owner,requester){requesters.set(owner,requester);},
    has:owner=>requesters.has(owner),
    async activate(owner){
      if(!requesters.has(owner))throw Error(`no foreground requester for ${owner}`);
      if(current===owner)return;
      await set(requesters.get(owner));current=owner;host.setForegroundServiceActive(true);
    },
    // Back to the kiln's private animation loop, as before any model loaded, so a producer
    // that installs its own requester (SF3D) does not meet another model's pending frame.
    async release(){
      if(current===null)return;
      await set(null);current=null;host.setForegroundServiceActive(false);
    },
  };
}

// A mesh run takes the kiln's foreground requester only once its own admission would
// pass, so a refused request cannot strand a running image without kiln frames.
export async function runWithKilnHandoff({service,input,handoff,owner,blocked=()=>null}){
  // The cross-model check comes first: a model's own read() reports refusals only
  // while idle, and a finished, failed or stopped state would otherwise pass here.
  const refusal=blocked();if(refusal)throw Error(refusal);
  const state=service.read();
  if(state.status==='unavailable')throw Error(state.error||'Generation is unavailable');
  if(['input','loading','queued','running','stopping','saving'].includes(state.status))throw Error('Generation is already running');
  if(state.pending)throw Error('Save the retained generated output before another run');
  if(!input?.source)throw Error('Choose a source image');
  if(handoff?.has(owner))await handoff.activate(owner);else await handoff?.release();
  return service.run(input);
}

export * from './authoring-image-generation-ui.mjs';
