import {Mesh, BufferGeometry, BufferAttribute, MeshNormalMaterial, DoubleSide} from '../lib/three.core.js';
import {cameraCrop, liveMeshFrame} from './hand-live-contract.mjs';
import {openCaptureStore} from './hand-live-retention.mjs';
import {openBrowserCaptureStore} from './hand-browser-retention.mjs';
import {nativeFingerPacket,idleFingerPacket,fingerFluidLoad} from './hand-live-fluid.mjs';

export default {
  id: 'hand-live', title: 'Live MobRecon hand',
  async create({host, inputs, record}) {
    const document = host.controls.document;
    const fingerJuice=inputs.fingerJuice===true;
    const browser=inputs.backend==='webgpu';
    const idlePacket=reason=>idleFingerPacket(reason,browser?'mobrecon-browser-mesh-finger-juice-v1':undefined);
    if(inputs.backend!==undefined&&!['webgpu','native'].includes(inputs.backend))throw Error('Unsupported hand backend');
    const browserBackend=browser?await (await import('./hand-browser-backend.mjs')).openBrowserHandBackend({host,inputs}):null;
    let scene,captures;
    try {
    const endpoint = new URL(inputs.endpoint ?? 'http://127.0.0.1:8791');
    if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:') throw Error('local diagnostic endpoint required');
    let apiTail=Promise.resolve();
    const requestApi = async (path, body) => {
      const response = await fetch(new URL(path,endpoint), body === undefined ? {cache:'no-store'} :
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const value = await response.json();
      if (!response.ok) throw Error(value.error ?? `HTTP ${response.status}`);
      return value;
    };
    const api=(path,body,source)=>{
      if(browserBackend)return browserBackend.api(path,body,source);
      const request=apiTail.then(()=>requestApi(path,body));
      apiTail=request.catch(()=>{});
      return request;
    };
    const health = await api('/health');
    if (health.status !== 'loaded' || health.identity?.model !== 'mobrecon_densestack_spiralconv' ||
        health.interactionAuthority !== false || health.faces?.length !== 1538) throw Error('unexpected native route');
    let acquisitionMode=inputs.acquisitionMode ?? 'manual', cropPadding=Number(inputs.cropPadding ?? 1.4), detectorThreshold=Number(inputs.detectorThreshold ?? .18);
    if (!['manual','detector'].includes(acquisitionMode) || (acquisitionMode==='detector' && !health.identity.detector)) throw Error('requested acquisition unavailable');
    scene = await host.scene.open();
    if(!browser)captures = await openCaptureStore();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(new Float32Array(778*3),3));
    geometry.setIndex(health.faces.flat());
    const mesh = new Mesh(geometry,new MeshNormalMaterial({side:DoubleSide}));
    mesh.name = browser?'MobRecon browser diagnostic':'MobRecon native diagnostic'; mesh.position.y=1.5; mesh.scale.setScalar(5); mesh.visible=false;
    const asset = await scene.attach(mesh,{owned:true,metadata:{label:mesh.name,type:'live-diagnostic',source:health.identity}});
    document.defaultView.kaminosSelection?.clear();
    const video = document.createElement('video'); video.muted=true; video.autoplay=true; video.playsInline=true;
    video.style.cssText='width:100%;display:block';
    const canvas = document.createElement('canvas'), context=canvas.getContext('2d');
    let stream, sessionId, running=false, starting=false, disposed=false, generation=0, frameCallback, flight, stopping;
    let status, button, overlay, error=null, last=null, received=0, lastSubmission=null;
    let particleCount=Number(inputs.particleCount??2400),sourceFlux=Number(inputs.sourceFlux??360);
    if(!Number.isSafeInteger(particleCount)||particleCount<1)throw Error('Invalid particle capacity');
    if(!Number.isFinite(sourceFlux)||sourceFlux<0)throw Error('Invalid source flux');
    let fluid=null,fluidError=null,fluidState=null,fluidPacket=idlePacket(),fluidKey=null,displayCenter=[0,0,0];
    let waterChanges=Promise.resolve(),rebuilding=false,waterInitialized=false;
    let capacityInput,fluxInput,waterStatus;
    const useFluid=operation=>{
      if(!fluid)return null;
      const owned=fluid;
      try{return operation(owned);}
      catch(cause){
        fluid=null;fluidState=null;fluidKey=null;fluidError=String(cause);fluidPacket=idlePacket('fluid_unavailable');
        try{owned.dispose();}catch(cleanup){fluidError+=`; cleanup: ${cleanup}`;}
        return null;
      }
    };
    const acquisitionControls = {};
    let handedness=inputs.handedness ?? 'right', cropX=.5, cropY=.5, cropSize=.85;
    const read = () => {
      const runtime=useFluid(live=>live.read());
      fluidState=runtime;
      return {authority:browser?'browser_webgpu_diagnostic_not_interaction':'live_native_diagnostic_not_interaction',interactionAuthority:false,
      identity:health.identity,endpoint:browser?null:endpoint.href,sessionId,running,starting,error,received,
      retention:browser?captures?.read()??null:null,
      captureId:last?.captureId ?? null,captureAgeMs:last ? Date.now()-last.captureEpochMs : null,
      visible:mesh.visible,handedness,crop:{x:cropX,y:cropY,size:cropSize},
      acquisitionMode,cropPadding,detectorThreshold,acquisition:last?.acquisition ?? null,
      acquisitionDetails:last?.acquisitionDetails ?? null,camera:stream?.getVideoTracks()[0]?.getSettings() ?? null,
      fingerJuice:{enabled:fingerJuice,packet:fluidPacket,runtime,error:fluidError,rebuilding,
        load:fingerFluidLoad(runtime,{particleCount,sourceFlux})}};
    };
    const updateFluid=()=>{
      if(!fluid)return;
      mesh.updateWorldMatrix(true,false);
      const packet=last?nativeFingerPacket(last,{nowMs:Date.now(),running,center:displayCenter,matrix:mesh.matrixWorld,sourceFlux,particleCount}):idlePacket();
      const key=JSON.stringify([packet.source_frame_id,packet.authority.reason,packet.emitters,packet.economics]);
      if(key===fluidKey)return;
      if(!useFluid(live=>{live.setPacket(packet);return true;}))return;
      fluidPacket=packet;fluidKey=key;
      fluidState=useFluid(live=>live.read());
      if(sessionId)emit({kind:'finger_juice',epochMs:Date.now(),packet,meshMatrix:mesh.matrixWorld.toArray()}).catch(cause=>{error=String(cause);});
    };
    const sync = () => {
      if(capacityInput&&document.activeElement!==capacityInput)capacityInput.value=particleCount;
      if(fluxInput&&document.activeElement!==fluxInput)fluxInput.value=sourceFlux;
      if(waterStatus){
        const load=fingerFluidLoad(fluidState,{particleCount,sourceFlux});
        waterStatus.textContent=rebuilding?`Allocating ${particleCount.toLocaleString()} particles...`:fluidError?`Water: ${fluidError}`:
          `${load.mountedParticleCount?.toLocaleString()??'No'} allocated | ${load.admittedRate===null?'unverified':Math.round(load.admittedRate).toLocaleString()+'/s admitted'}${load.poolLimited?' | pool limited':''}`;
      }
      if (button) {button.textContent=running?'Stop camera':starting?'Starting camera':'Start camera';button.disabled=starting;}
      if (status) status.textContent = error ? `Stopped: ${error}${last ? ` | last computed mesh retained | sample age ${Math.round(Date.now()-last.captureEpochMs)} ms` : ''}` :
        `${running?'LIVE CAMERA':'STOPPED'} | MobRecon / ${browser?'WebGPU':'CPU'} | ${received} meshes${last?` | sample age ${Math.round(Date.now()-last.captureEpochMs)} ms`:''} | ${last?.acquisitionDetails?.fallback?'NO DETECTION: MANUAL CROP FALLBACK':last?.acquisition==='wilor_yolo_detector_bbox_only'?`YOLO / ${browser?'WebGPU':'MLX'} crop`:acquisitionMode==='detector'?'AUTO: awaiting detection':'MANUAL CROP'} | ${fingerJuice?`Finger Juice: ${fluidError??fluidPacket.authority.reason??(fluidPacket.emitters.filter(e=>e.active).map(e=>e.id).join(', ')||'no extended fingers')}`:'diagnostic, no interaction'}`;
      if (overlay && video.videoWidth) {
        const [x0,y0,x1,y1]=acquisitionMode==='detector' && last ? last.cropBox : cameraCrop(video.videoWidth,video.videoHeight,cropX,cropY,cropSize);
        overlay.style.borderColor=last?.acquisitionDetails?.fallback?'#ff725e':acquisitionMode==='detector'?'#60e1a1':'#ffd75a';
        Object.assign(overlay.style,{left:`${x0/video.videoWidth*100}%`,top:`${y0/video.videoHeight*100}%`,
          width:`${(x1-x0)/video.videoWidth*100}%`,height:`${(y1-y0)/video.videoHeight*100}%`});
      }
    };
    const emit = async value => {
      const event={sessionId,...value};
      if(browser){captures.event(event);return;}
      return api('/event',event);
    };
    const stop = () => stopping??=(async () => {
      running=false; generation++;
      if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
      stream?.getTracks().forEach(track=>track.stop()); stream=null;video.srcObject=null;
      updateFluid();useFluid(live=>live.setPaused(true));sync();
      if (flight) await flight.catch(()=>{});
      try {await browserBackend?.stopRecording();}
      finally {
        try {if (sessionId) await emit({kind:'stop',epochMs:Date.now(),lastCaptureId:last?.captureId ?? null});}
        finally {if(browser)await captures?.flush();}
      }
      record({kind:'hand-live.stop',phase:'applied',effective:read()});return read();
    })().finally(()=>{stopping=null;});
    const schedule = ticket => {
      if (!running || ticket!==generation || disposed) return;
      frameCallback=video.requestVideoFrameCallback((now,metadata) => {
        flight=infer(ticket,metadata).catch(async cause => {
          error=String(cause); running=false; stream?.getTracks().forEach(track=>track.stop());stream=null; sync();
          updateFluid();useFluid(live=>live.setPaused(true));
          if(sessionId) await emit({kind:'failure',error,epochMs:Date.now(),submission:lastSubmission}).catch(()=>{});
          await browserBackend?.stopRecording().catch(cause=>{error+=`; ${cause}`;sync();});
          if(browser)await captures?.flush().catch(cause=>{error+=`; ${cause}`;sync();});
        }).finally(()=>{flight=null;schedule(ticket);});
      });
    };
    const infer = async (ticket,metadata) => {
      if(canvas.width!==video.videoWidth)canvas.width=video.videoWidth;
      if(canvas.height!==video.videoHeight)canvas.height=video.videoHeight;
      const capture={captureId:crypto.randomUUID(),captureEpochMs:Date.now(),acquisitionMode,cropPadding,detectorThreshold};
      context.drawImage(video,0,0);
      const request={...capture,sessionId,handedness,pixelBasis:'unmirrored_camera',
        clock:'browser_sample_not_sensor_exposure',videoFrameMetadata:metadata,
        cropBox:cameraCrop(canvas.width,canvas.height,cropX,cropY,cropSize),
        ...(browser?{}:{imageMime:'image/jpeg',image:canvas.toDataURL('image/jpeg',.95).split(',')[1]})};
      lastSubmission={captureId:capture.captureId,database:'hand-live-diagnostic',store:'captures',origin:document.location.origin};
      const retained={captureId:capture.captureId,request,identity:health.identity,outcome:{state:'submitted'}};
      if(!browser)await captures.put(retained);
      let result;
      let bitmap,submitted=false;
      try {
        if(browser) {
          captures.check();
          bitmap=await createImageBitmap(canvas);
          // The route synchronously uploads this snapshot before its first await.
          const inference=api('/frame',request,bitmap);
          try{captures.begin(retained,bitmap);submitted=true;bitmap=null;}
          catch(cause){await inference.catch(()=>{});throw cause;}
          result=await inference;
          captures.finish(capture.captureId,{state:'computed',prediction:result});
        } else {
          result=await api('/frame',request,canvas);
          await captures.put({...retained,outcome:{state:'computed',serverOutput:result.output}});
        }
      } catch(cause) {
        bitmap?.close();
        const outcome={state:'failed',error:String(cause),epochMs:Date.now()};
        if(browser){if(submitted)captures.finish(capture.captureId,outcome);}
        else await captures.put({...retained,outcome});
        throw cause;
      }
      if(ticket!==generation || disposed) {
        await emit({kind:'not_presented_after_stop',captureId:capture.captureId,epochMs:Date.now()});return;
      }
      const positions=liveMeshFrame(result,capture,health.identity);
      // Display-only centering and fixed scale; native predictions stay untouched on disk.
      const center=[0,0,0];
      for(let i=0;i<positions.length;i++) center[i%3]+=positions[i]/778;
      displayCenter=center;
      for(let i=0;i<positions.length;i++) positions[i]=(positions[i]-center[i%3])*(i%3===1?-1:1);
      geometry.setAttribute('position',new BufferAttribute(positions,3));
      geometry.setIndex(health.faces.flatMap(f=>result.handedness==='left'?[f[0],f[2],f[1]]:f));
      geometry.computeVertexNormals();geometry.computeBoundingSphere();mesh.visible=true;
      last=result;received++;updateFluid();scene.redraw();sync();
      await emit({kind:'presented',captureId:capture.captureId,epochMs:Date.now(),view:scene.readView(),
        displayTransform:{center,scale:5,invertY:true}});
    };
    const frame = () => scene.setView(fingerJuice?{position:[0,2.3,document.defaultView.innerWidth<600?7:5],target:[0,.7,0]}:{position:[0,1.5,document.defaultView.innerWidth<600?6:4.2],target:[0,1.5,0]});
    const setAcquisition = value => {
      if (!['manual','detector'].includes(value.mode) || (value.mode==='detector' && !health.identity.detector)) throw Error('requested acquisition unavailable');
      const padding=Number(value.padding ?? cropPadding), threshold=Number(value.threshold ?? detectorThreshold);
      if (!Number.isFinite(padding) || padding<1 || !Number.isFinite(threshold) || threshold<0 || threshold>1) throw Error('invalid acquisition config');
      acquisitionMode=value.mode;cropPadding=padding;detectorThreshold=threshold;sync();
      if(acquisitionControls.mode) acquisitionControls.mode.value=acquisitionMode;
      if(acquisitionControls.padding) acquisitionControls.padding.value=cropPadding;
      if(acquisitionControls.threshold) acquisitionControls.threshold.value=detectorThreshold;
      record({kind:'hand-live.acquisition',phase:'applied',effective:read()});return read();
    };
    const queueWater=operation=>{
      const task=waterChanges.then(operation);waterChanges=task.catch(()=>{});return task;
    };
    const mountWater=async count=>{
      rebuilding=true;waterInitialized=true;fluidState=null;fluidKey=null;
      const previous=fluid;fluid=null;sync();
      try{
        await previous?.dispose();
        if(disposed)throw Error('experiment closed');
        const candidate=await host.fluid.openInlets({setup:{schema:'kaminos.local-liquid-setup.v1',support:'retained_analytical_basin',particleCount:count,densityIterations:3,showSupportGeometry:true},packet:idlePacket()});
        if(disposed){await candidate.dispose();throw Error('experiment closed');}
        fluid=candidate;fluidError=null;updateFluid();useFluid(live=>live.setPaused(!running));
        fluidState=useFluid(live=>live.read());
      }catch(cause){fluidError=String(cause);throw cause;}
      finally{rebuilding=false;sync();}
    };
    const setParticleCount=value=>{
      if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid particle capacity');
      if(disposed)throw Error('experiment closed');
      particleCount=value;sync();
      return queueWater(async()=>{
        if(disposed)throw Error('experiment closed');
        if(waterInitialized||starting)await mountWater(value);
        record({kind:'hand-live.capacity',phase:'applied',effective:read()});return read();
      });
    };
    frame();
    const unsubscribe=scene.onFrame(()=>{updateFluid();sync();});
    const start = async () => {
      if(running || starting) return read();
      if(disposed) throw Error('experiment closed');
      if(flight) await flight;
      if(stopping)await stopping.catch(()=>{});
      starting=true;error=null;sync();const ticket=++generation;
      try {
        if(browser) {
          if(captures?.read().error){await captures.close().catch(()=>{});captures=null;}
          captures??=await openBrowserCaptureStore({onFailure:cause=>{
            error=String(cause);stop().catch(cleanup=>{error=String(cleanup);sync();});
          }});
        }
        if(fingerJuice)await queueWater(async()=>{if(!fluid)await mountWater(particleCount);});
        if(disposed||ticket!==generation)return read();
        const created=await api('/session',{source:'browser_camera',handedness,pixelBasis:'unmirrored_camera'});
        sessionId=created.sessionId;
        if(disposed || ticket!==generation) return read();
        const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480}},audio:false});
        if(disposed || ticket!==generation){acquired.getTracks().forEach(t=>t.stop());return read();}
        stream=acquired;video.srcObject=stream;await video.play();
        if(disposed || ticket!==generation){stream?.getTracks().forEach(t=>t.stop());return read();}
        await browserBackend?.startRecording(sessionId);
        if(disposed || ticket!==generation){await browserBackend?.stopRecording();return read();}
        running=true;last=null;received=0;mesh.visible=false;fluidKey=null;updateFluid();useFluid(live=>live.setPaused(false));scene.redraw();schedule(ticket);
        record({kind:'hand-live.start',phase:'applied',effective:read()});return read();
      } catch(cause) {error=String(cause);stream?.getTracks().forEach(t=>t.stop());stream=null;await browserBackend?.stopRecording();throw cause;}
      finally {starting=false;sync();}
    };
    return {
      read,operations:{start,stop,frame,setAcquisition,setParticleCount,setSourceFlux(value){
        if(!Number.isFinite(value)||value<0)throw Error('Invalid source flux');sourceFlux=value;updateFluid();
        sync();record({kind:'hand-live.flux',phase:'applied',effective:read()});return read();
      }},
      mount({root,document,invoke}) {
        const preview=document.createElement('div');preview.style.cssText='position:relative;overflow:hidden';
        overlay=document.createElement('div');overlay.style.cssText='position:absolute;border:2px solid #ffd75a;pointer-events:none;box-sizing:border-box';
        preview.append(video,overlay);
        const select=document.createElement('select');select.setAttribute('aria-label','Hand');
        for(const side of ['right','left']){const opt=document.createElement('option');opt.value=side;opt.textContent=side==='right'?'Right hand':'Left hand';select.append(opt);}
        select.value=handedness;select.onchange=()=>{handedness=select.value;};
        button=document.createElement('button');button.onclick=()=>invoke(running?'stop':'start').catch(cause=>{error=String(cause);sync();});
        const frameButton=document.createElement('button');frameButton.textContent='Frame hand';frameButton.onclick=()=>invoke('frame');
        status=document.createElement('div');status.dataset.handLiveStatus='';status.setAttribute('role','status');status.style.overflowWrap='anywhere';
        root.append(preview,select,button,frameButton);
        if(fingerJuice){
          for(const [labelText,value,min,step,operation] of [['Particle capacity',particleCount,0,2400,'setParticleCount'],['Emission / second',sourceFlux,0,60,'setSourceFlux']]){
            const label=document.createElement('label');label.textContent=labelText;label.style.display='block';
            const input=document.createElement('input');input.type='number';input.min=min;input.step=step;input.value=value;
            input.style.cssText='width:100%;box-sizing:border-box';input.setAttribute('aria-label',labelText);
            if(operation==='setParticleCount'){capacityInput=input;input.title='Changing capacity restarts the water';}else fluxInput=input;
            input.onchange=()=>invoke(operation,Number(input.value)).catch(cause=>{fluidError=String(cause);sync();});
            label.append(input);root.append(label);
          }
          waterStatus=document.createElement('output');waterStatus.dataset.handWaterLoad='';waterStatus.style.cssText='display:block;overflow-wrap:anywhere';root.append(waterStatus);
        }
        const modeSelect=document.createElement('select');modeSelect.setAttribute('aria-label','Crop mode');
        for(const [value,label] of [['detector','Automatic crop'],['manual','Manual crop']]) {
          const option=document.createElement('option');option.value=value;option.textContent=label;
          option.disabled=value==='detector'&&!health.identity.detector;modeSelect.append(option);
        }
        modeSelect.value=acquisitionMode;
        acquisitionControls.mode=modeSelect;
        modeSelect.onchange=()=>invoke('setAcquisition',{mode:modeSelect.value}).catch(cause=>{error=String(cause);sync();});
        root.append(modeSelect);
        for(const [label,key,value,min,step] of [['Auto padding','padding',cropPadding,1,.1],['Detector threshold','threshold',detectorThreshold,0,.01]]) {
          const holder=document.createElement('label');holder.textContent=label;
          const input=document.createElement('input');input.type='number';input.min=min;input.step=step;input.value=value;
          acquisitionControls[key]=input;
          if(key==='threshold') input.max=1;
          input.setAttribute('aria-label',label);input.style.width='100%';
          input.onchange=()=>invoke('setAcquisition',{mode:acquisitionMode,[key]:Number(input.value)}).catch(cause=>{error=String(cause);sync();});
          holder.append(input);root.append(holder);
        }
        for(const [label,value,change] of [['Crop X',cropX,v=>cropX=v],['Crop Y',cropY,v=>cropY=v],['Crop size',cropSize,v=>cropSize=v]]) {
          const holder=document.createElement('label');holder.textContent=label;
          const input=document.createElement('input');input.type='range';input.min=label==='Crop size'?'.1':'0';input.max='1';input.step='.01';input.value=value;input.setAttribute('aria-label',label);input.style.width='100%';
          input.oninput=()=>{change(Number(input.value));sync();};holder.append(input);root.append(holder);
        }
        root.append(status);sync();
      },
      async dispose(){
        disposed=true;unsubscribe();
        try {await stop();}
        finally {
          await waterChanges;
          const owned=fluid;fluid=null;
          try{await owned?.dispose();}finally{try{await captures?.close();}finally{try{await browserBackend?.close();}finally{await scene.dispose();}}}
        }
      },
    };
    } catch(cause) {
      try{await captures?.close();}finally{try{await scene?.dispose();}finally{await browserBackend?.close();}}
      throw cause;
    }
  },
};
