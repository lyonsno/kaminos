import {createSceneFrameComposition} from './scene-frame-composition.mjs';

// GPU objects and synchronous callbacks remain local to this execution owner.
// UI/status publication belongs to the injected domain draw, not this host.
export function createSceneFrameRuntime({readInputs,draw,frameCount,prepare,readDepth,readSharedDevice,readCamera,
  coordinator,readSimInputs}){
  const composition=createSceneFrameComposition({readInputs,draw,frameCount,prepare});
  let lastPlannedSceneFrame=-1;
  function planFrame(nowMs=performance.now()){
    const existing=coordinator.read().lastPlan;
    if(existing&&(lastPlannedSceneFrame===frameCount()||Math.abs(nowMs-existing.nowMs)<1))return existing;
    lastPlannedSceneFrame=frameCount();
    return coordinator.planFrame({nowMs,...readSimInputs(nowMs)});
  }
  function depth({enabled=true,held=false}={}){
    if(held||!enabled)return null;
    const device=readSharedDevice();
    if(!device)throw Error('ordinary-scene-depth-shared-device-unavailable');
    prepare();
    if(!composition.renderDepth())return null;
    return {device,camera:readCamera(),texture:readDepth()};
  }
  return Object.freeze({composition,planFrame,depth,
    consumeTransport:frame=>composition.withTransport(frame,()=>frame.renderHost()),
    render:composition.render,renderOrdinary:composition.renderOrdinary,
    runForegroundFrame:composition.runForegroundFrame,setForegroundServiceActive:composition.setForegroundServiceActive,
  });
}
