// Opt-in measurements at the ordinary host animation boundary. The host owns
// the scene, renderer and clock; this adapter neither replaces nor replays them.
export function createPerformanceHarness({read, apply, requestFrame}) {
  let pending = null, lastRun = null;
  const require = (ok, message) => { if (!ok) throw Error(message); };
  const identity = state => JSON.stringify({generation:state.clock.generation,
    step:state.clock.step, camera:state.camera, extent:state.extent,
    controls:state.controls, workload:state.workload, device:state.device});
  function fail(error) {
    if (!pending) return;
    const run = pending; pending = null;
    lastRun={status:'failed',failure:error.message,frames:run.frames,gpuSamples:run.gpuSamples};
    error.partialFrames = run.frames;
    run.reject(error);
  }
  function sample({frames, warmupFrames = 0, gpuSamples = 0} = {}) {
    require(!pending, 'Performance sampling already active');
    require(Number.isSafeInteger(frames) && frames >= 2, 'At least two actual frames required');
    require(Number.isSafeInteger(warmupFrames) && warmupFrames >= 0, 'Invalid warmup frame count');
    require(Number.isSafeInteger(gpuSamples) && gpuSamples >= 0, 'Invalid GPU sample count');
    const state = read();
    require(state.clock.available && state.clock.paused && state.clock.running,
      'Performance rendering comparison requires held water and an active host');
    require(state.device.backend === 'webgpu' && state.device.shared && state.device.fallback === false,
      'Performance comparison requires native shared WebGPU without fallback');
    require(['gtao','combined'].includes(state.controls.sceneGIMode), 'Unsupported scene lighting route');
    require(state.controls.sceneGI.view==='scene', 'Performance comparison requires composed scene lighting');
    if(gpuSamples)require(state.controls.timingEnabled&&state.gpuTiming.available,'GPU comparison requires enabled native timestamps');
    require(document.visibilityState === 'visible', 'Performance page must be visible');
    return new Promise((resolve, reject) => {
      pending = {frames:[],gpuSamples:[],gpuCount:gpuSamples,startedAt:performance.now(),remainingWarmup:warmupFrames, count:frames, workStart:state.aoWork,giWorkStart:state.giWork,
        identity:identity(state), resolve, reject};
      requestFrame();
    });
  }
  function record({startedAt, endedAt, rendered}) {
    if (!pending) return;
    try {
      const state = read();
      require(document.visibilityState === 'visible', 'Performance page became hidden');
      require(state.clock.paused && state.clock.running && state.clock.available,
        'Held water or host playback changed during performance sampling');
      require(identity(state) === pending.identity, 'Performance source, camera, extent or controls changed');
      require(!state.failure, `Host render failed: ${state.failure}`);
      if(pending.gpuCount){
        require(!state.gpuTiming.failure,`GPU measurement failed: ${state.gpuTiming.failure}`);
        const gpu=state.gpuTiming.sample;
        const lighting={...state.controls.sceneGI,aoEnabled:state.controls.sceneAOEnabled,aoIntensity:state.controls.aoIntensity};
        if(!pending.remainingWarmup&&gpu&&gpu.encodedAt>pending.startedAt&&
            gpu.waterEnabled===state.controls.waterEnabled&&gpu.captureMode===state.controls.captureMode&&
            JSON.stringify(gpu.sceneLighting)===JSON.stringify(lighting)&&
            !pending.gpuSamples.some(s=>s.measuredAt===gpu.measuredAt))pending.gpuSamples.push(gpu);
      }
      if (rendered) {
        require(state.render.waterEnabled === state.controls.waterEnabled,
          'Requested water rendering was not exercised');
        require(Number.isFinite(endedAt-startedAt) && endedAt > startedAt, 'Invalid callback timing');
        if (pending.remainingWarmup) {pending.remainingWarmup--;pending.workStart=state.aoWork;pending.giWorkStart=state.giWork;pending.startedAt=performance.now();}
        else pending.frames.push({frameId:state.render.frameId, route:state.render.route,
          waterEnabled:state.render.waterEnabled, startedAt, endedAt,
          callbackMs:endedAt-startedAt, aoWork:{...state.aoWork},giWork:{...state.giWork}});
        if (pending.frames.length >= pending.count&&pending.gpuSamples.length>=pending.gpuCount) {
          const run = pending; pending = null;
          lastRun={status:'complete',state,frames:run.frames,gpuSamples:run.gpuSamples,workStart:run.workStart,giWorkStart:run.giWorkStart};
          run.resolve(lastRun);
          return;
        }
      }
      requestFrame();
    } catch (error) { fail(error); }
  }
  return {read, sample, record, fail, progress:()=>pending?{status:'sampling',remainingWarmup:pending.remainingWarmup,frames:pending.frames,gpuSamples:pending.gpuSamples}:lastRun, apply(patch) {
    require(!pending, 'Cannot edit a performance case during sampling');
    require(patch && typeof patch === 'object' && !Array.isArray(patch), 'Performance case must be an object');
    for (const key of Object.keys(patch)) require(['waterEnabled','sceneAOEnabled','sceneGIMode','captureMode','renderScale','energyDiagnosticsMode','timingEnabled','fresnelCutoff'].includes(key), `Unsupported performance control: ${key}`);
    if ('waterEnabled' in patch) require(typeof patch.waterEnabled === 'boolean', 'waterEnabled must be boolean');
    if ('sceneGIMode' in patch) require(['gtao','combined'].includes(patch.sceneGIMode), 'Unknown scene GI mode');
    if ('captureMode' in patch) require(['stable','switching'].includes(patch.captureMode), 'Unknown capture mode');
    if ('fresnelCutoff' in patch) require(Number.isFinite(patch.fresnelCutoff) && patch.fresnelCutoff >= 0 && patch.fresnelCutoff <= 1, 'Invalid Fresnel cutoff');
    apply(patch); requestFrame(); return read();
  }};
}
