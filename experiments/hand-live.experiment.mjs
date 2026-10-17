import {Mesh, BufferGeometry, BufferAttribute, MeshNormalMaterial, DoubleSide} from '../lib/three.core.js';
import {cameraCrop, liveMeshFrame} from './hand-live-contract.mjs';

export default {
  id: 'hand-live', title: 'Live MobRecon hand',
  async create({host, inputs, record}) {
    const document = host.controls.document;
    const endpoint = new URL(inputs.endpoint ?? 'http://127.0.0.1:8791');
    if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:') throw Error('local diagnostic endpoint required');
    const api = async (path, body) => {
      const response = await fetch(new URL(path,endpoint), body === undefined ? {cache:'no-store'} :
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const value = await response.json();
      if (!response.ok) throw Error(value.error ?? `HTTP ${response.status}`);
      return value;
    };
    const health = await api('/health');
    if (health.status !== 'loaded' || health.identity?.model !== 'mobrecon_densestack_spiralconv' ||
        health.interactionAuthority !== false || health.faces?.length !== 1538) throw Error('unexpected native route');
    const scene = await host.scene.open();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(new Float32Array(778*3),3));
    geometry.setIndex(health.faces.flat());
    const mesh = new Mesh(geometry,new MeshNormalMaterial({side:DoubleSide}));
    mesh.name = 'MobRecon native diagnostic'; mesh.position.y=1.5; mesh.scale.setScalar(5); mesh.visible=false;
    const asset = await scene.attach(mesh,{owned:true,metadata:{label:mesh.name,type:'live-diagnostic',source:health.identity}});
    document.defaultView.kaminosSelection?.clear();
    const video = document.createElement('video'); video.muted=true; video.autoplay=true; video.playsInline=true;
    video.style.cssText='width:100%;display:block';
    const canvas = document.createElement('canvas'), context=canvas.getContext('2d');
    let stream, sessionId, running=false, starting=false, disposed=false, generation=0, frameCallback, flight;
    let status, button, overlay, error=null, last=null, received=0;
    let handedness=inputs.handedness ?? 'right', cropX=.5, cropY=.5, cropSize=.85;
    const read = () => ({authority:'live_native_diagnostic_not_interaction',interactionAuthority:false,
      identity:health.identity,endpoint:endpoint.href,sessionId,running,starting,error,received,
      captureId:last?.captureId ?? null,captureAgeMs:last ? Date.now()-last.captureEpochMs : null,
      visible:mesh.visible,handedness,crop:{x:cropX,y:cropY,size:cropSize},
      acquisition:'operator_selected_crop_no_detector',camera:stream?.getVideoTracks()[0]?.getSettings() ?? null});
    const sync = () => {
      if (button) {button.textContent=running?'Stop camera':starting?'Starting camera':'Start camera';button.disabled=starting;}
      if (status) status.textContent = error ? `Stopped: ${error}${last ? ' | last computed mesh retained' : ''}` :
        `${running?'LIVE CAMERA':'STOPPED'} | MobRecon / CPU | ${received} meshes${last?` | sample age ${Math.round(Date.now()-last.captureEpochMs)} ms`:''} | diagnostic, no interaction`;
      if (overlay && video.videoWidth) {
        const [x0,y0,x1,y1]=cameraCrop(video.videoWidth,video.videoHeight,cropX,cropY,cropSize);
        Object.assign(overlay.style,{left:`${x0/video.videoWidth*100}%`,top:`${y0/video.videoHeight*100}%`,
          width:`${(x1-x0)/video.videoWidth*100}%`,height:`${(y1-y0)/video.videoHeight*100}%`});
      }
    };
    const emit = value => api('/event',{sessionId,...value});
    const stop = async () => {
      running=false; generation++;
      if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
      stream?.getTracks().forEach(track=>track.stop()); stream=null;video.srcObject=null;sync();
      if (flight) await flight.catch(()=>{});
      if (sessionId) await emit({kind:'stop',epochMs:Date.now(),lastCaptureId:last?.captureId ?? null});
      record({kind:'hand-live.stop',phase:'applied',effective:read()});return read();
    };
    const schedule = ticket => {
      if (!running || ticket!==generation || disposed) return;
      frameCallback=video.requestVideoFrameCallback((now,metadata) => {
        flight=infer(ticket,metadata).catch(async cause => {
          error=String(cause); running=false; stream?.getTracks().forEach(track=>track.stop());stream=null; sync();
          if(sessionId) await emit({kind:'failure',error,epochMs:Date.now()}).catch(()=>{});
        }).finally(()=>{flight=null;schedule(ticket);});
      });
    };
    const infer = async (ticket,metadata) => {
      canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const capture={captureId:crypto.randomUUID(),captureEpochMs:Date.now()};
      context.drawImage(video,0,0);
      const request={...capture,sessionId,handedness,pixelBasis:'unmirrored_camera',
        clock:'browser_sample_not_sensor_exposure',videoFrameMetadata:metadata,
        cropBox:cameraCrop(canvas.width,canvas.height,cropX,cropY,cropSize),
        image:canvas.toDataURL('image/jpeg',.95).split(',')[1]};
      const result=await api('/frame',request);
      if(ticket!==generation || disposed) {
        await emit({kind:'not_presented_after_stop',captureId:capture.captureId,epochMs:Date.now()});return;
      }
      const positions=liveMeshFrame(result,capture,health.identity);
      // Display-only centering and fixed scale; native predictions stay untouched on disk.
      const center=[0,0,0];
      for(let i=0;i<positions.length;i++) center[i%3]+=positions[i]/778;
      for(let i=0;i<positions.length;i++) positions[i]=(positions[i]-center[i%3])*(i%3===1?-1:1);
      geometry.setAttribute('position',new BufferAttribute(positions,3));
      geometry.setIndex(health.faces.flatMap(f=>result.handedness==='left'?[f[0],f[2],f[1]]:f));
      geometry.computeVertexNormals();geometry.computeBoundingSphere();mesh.visible=true;
      last=result;received++;scene.redraw();sync();
      await emit({kind:'presented',captureId:capture.captureId,epochMs:Date.now(),view:scene.readView(),
        displayTransform:{center,scale:5,invertY:true}});
    };
    const frame = () => scene.setView({position:[0,1.5,document.defaultView.innerWidth<600?6:4.2],target:[0,1.5,0]});
    frame();
    const unsubscribe=scene.onFrame(sync);
    const start = async () => {
      if(running || starting) return read();
      if(disposed) throw Error('experiment closed');
      if(flight) await flight;
      starting=true;error=null;sync();const ticket=++generation;
      try {
        const created=await api('/session',{source:'browser_camera',handedness,pixelBasis:'unmirrored_camera'});
        sessionId=created.sessionId;
        const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480}},audio:false});
        if(disposed || ticket!==generation){acquired.getTracks().forEach(t=>t.stop());return read();}
        stream=acquired;video.srcObject=stream;await video.play();
        if(disposed || ticket!==generation){stream?.getTracks().forEach(t=>t.stop());return read();}
        running=true;last=null;received=0;mesh.visible=false;scene.redraw();schedule(ticket);
        record({kind:'hand-live.start',phase:'applied',effective:read()});return read();
      } catch(cause) {error=String(cause);stream?.getTracks().forEach(t=>t.stop());stream=null;throw cause;}
      finally {starting=false;sync();}
    };
    return {
      read,operations:{start,stop,frame},
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
        for(const [label,value,change] of [['Crop X',cropX,v=>cropX=v],['Crop Y',cropY,v=>cropY=v],['Crop size',cropSize,v=>cropSize=v]]) {
          const holder=document.createElement('label');holder.textContent=label;
          const input=document.createElement('input');input.type='range';input.min=label==='Crop size'?'.1':'0';input.max='1';input.step='.01';input.value=value;input.setAttribute('aria-label',label);input.style.width='100%';
          input.oninput=()=>{change(Number(input.value));sync();};holder.append(input);root.append(holder);
        }
        root.append(status);sync();
      },
      async dispose(){disposed=true;unsubscribe();await stop();await scene.dispose();},
    };
  },
};
