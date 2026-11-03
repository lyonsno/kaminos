// Shared admission and frame scopes for the ordinary scene. Producers keep
// their own clocks and submission mechanisms; this owner decides whether the
// scene may draw and whether this invocation actually did so.
export function createSceneFrameComposition({readInputs,draw,prepare=()=>{},frameCount}) {
  let serviceActive=false,insideService=false,transportFrame=null,depthDrawn=false;
  let lastBlockedReason=null;
  function blockedReason() {
    const input=readInputs();
    if(input.lightingHeld)return 'lighting-preparation';
    if(input.exclusiveInspection&&!input.manualInspection)return 'exclusive-inspection';
    if(input.transportRequired&&!transportFrame)return 'transport-not-supplied';
    if(input.radianceReady===false)return 'radiance-not-current';
    return null;
  }
  function render() {
    lastBlockedReason=blockedReason();
    if(lastBlockedReason)return false;
    const before=frameCount();
    draw();
    return frameCount()>before;
  }
  function renderDepth() {
    const drawn=render();
    if(drawn)depthDrawn=true;
    return drawn;
  }
  function renderOrdinary() {
    if(serviceActive)return false;
    // A current volume prepass already rendered the scene for this RAF.
    if(depthDrawn){depthDrawn=false;return true;}
    return render();
  }
  function runForegroundFrame(run) {
    if(!serviceActive||insideService)throw Error('invalid foreground scene frame state');
    insideService=true;depthDrawn=false;
    const before=frameCount();
    try {
      const result=run();
      if(frameCount()===before){prepare();render();}
      const after=frameCount(),drawn=after>before;
      return {...result,sceneFrameCount:after,sceneFrameCountBefore:before,sceneFrameCountAfter:after,sceneDrawn:drawn,
        sceneAuthority:drawn?'three-render-returned-inside-service-not-presentation':'scene-draw-skipped-this-request'};
    } finally {insideService=false;depthDrawn=false;}
  }
  return Object.freeze({render,renderDepth,renderOrdinary,runForegroundFrame,
    setForegroundServiceActive(value){serviceActive=Boolean(value);},
    withTransport(frame,run){const prior=transportFrame;transportFrame=frame;try{return run();}finally{transportFrame=prior;}},
    get transportFrame(){return transportFrame;},
    state:()=>({serviceActive,insideService,lastBlockedReason}),
  });
}
