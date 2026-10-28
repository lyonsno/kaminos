import {Mesh, BufferGeometry, BufferAttribute, MeshNormalMaterial, DoubleSide, Sprite, SpriteMaterial, CanvasTexture} from '../lib/three.core.js';
import {validateModels, pairedPrediction, sharedInference, cameraCrop} from './hand-pair-contract.mjs';
import {openCaptureStore} from './hand-pair-retention.mjs';

export default {
  id:'hand-pair', title:'Original / trained hands',
  async create({host, inputs, record}) {
    const document=host.controls.document;
    const configs=inputs.models;
    if (!Array.isArray(configs) || configs.length!==2) throw Error('two explicit model endpoints and checkpoint hashes required');
    const apis=configs.map(config=>{
      const endpoint=new URL(config.endpoint);
      if(endpoint.protocol!=='http:' || endpoint.hostname!=='127.0.0.1') throw Error('local diagnostic endpoint required');
      let tail=Promise.resolve();
      return (path,body)=>{
        const task=tail.then(async()=>{
          const response=await fetch(new URL(path,endpoint),body===undefined?{cache:'no-store'}:
            {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          const value=await response.json();
          if(!response.ok)throw Error(value.error??`HTTP ${response.status}`);
          return value;
        });
        tail=task.catch(()=>{});return task;
      };
    });
    const health=await Promise.all(apis.map(api=>api('/health')));
    validateModels(health,configs.map(c=>c.checkpointSha256));
    if(!health[0].identity.detector)throw Error('original endpoint must supply shared detector');
    const identities=health.map(h=>h.identity);
    const scene=await host.scene.open();
    let captures;
    try{captures=await openCaptureStore();}catch(e){await scene.dispose();throw e;}
    const meshes=[], labels=[];
    try{
      for(let i=0;i<2;i++){
        const geometry=new BufferGeometry();
        geometry.setAttribute('position',new BufferAttribute(new Float32Array(778*3),3));
        geometry.setIndex(health[i].faces.flat());
        const mesh=new Mesh(geometry,new MeshNormalMaterial({side:DoubleSide}));
        mesh.name=i?'Trained hand':'Original hand';mesh.position.set(i?.8:-.8,1.2,0);mesh.scale.setScalar(5);mesh.visible=false;
        await scene.attach(mesh,{owned:true,metadata:{label:mesh.name,type:'live-diagnostic',source:identities[i]}});
        meshes.push(mesh);
        const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#20242c';ctx.fillRect(0,0,512,96);
        ctx.font='bold 40px system-ui';ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.fillText(i?'Trained':'Original',256,62);
        const label=new Sprite(new SpriteMaterial({map:new CanvasTexture(canvas),depthTest:false}));
        label.name=mesh.name+' label';label.position.set(i?.8:-.8,2.4,0);label.scale.set(1.15,.216,1);
        await scene.attach(label,{owned:true,metadata:{label:label.name,type:'comparison-label'}});labels.push(label);
      }
    }catch(e){captures.close();await scene.dispose();throw e;}
    document.defaultView.kaminosSelection?.clear();
    const video=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;
    video.style.cssText='position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    const sample=document.createElement('img');sample.dataset.handPairSample='';
    sample.alt='Exact camera sample used by both displayed hands';
    sample.style.cssText='width:100%;display:block;min-height:120px';
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    let stream, sessions=[],running=false,starting=false,disposed=false,generation=0,callback,flight;
    let error=null,received=0,last=null,status,button,select,overlay;
    let handedness=inputs.handedness??'right';
    if(!['right','left'].includes(handedness)){captures.close();await scene.dispose();throw Error('invalid handedness');}
    const read=()=>({running,starting,error,received,captureId:last?.captureId??null,
      captureAgeMs:last?Date.now()-last.captureEpochMs:null,handedness,
      models:configs.map((c,i)=>({label:i?'Trained':'Original',endpoint:c.endpoint,identity:identities[i],sessionId:sessions[i],visible:meshes[i].visible})),
      source:'one_camera_same_jpeg_and_crop',presentation:'atomic_pair_wrist_aligned_equal_scale',
      backend:'native_cpu_serial_shared_mlx_detector',fingerJuice:{enabled:false,runtime:null},
      lastPair:last,sourceImage:{captureId:sample.dataset.captureId??null,available:!!sample.getAttribute('src')},
      camera:stream?.getVideoTracks()[0]?.getSettings()??null});
    const sync=()=>{
      if(button){button.textContent=running?'Stop camera':starting?'Starting camera':'Start camera';button.disabled=starting;}
      if(select)select.disabled=running||starting;
      if(status)status.textContent=error?`Stopped: ${error}${last?' · last complete pair retained':''}`:
        `${running?'LIVE':'STOPPED'} · ${received} matched pairs · native CPU${last?` · sample age ${Math.round(Date.now()-last.captureEpochMs)} ms`:''}${last?.fallback?' · no detection: shared manual fallback':''}`;
      if(overlay&&last){const [x0,y0,x1,y1]=last.cropBox,[width,height]=last.imageSize;
        Object.assign(overlay.style,{left:`${100*x0/width}%`,top:`${100*y0/height}%`,width:`${100*(x1-x0)/width}%`,height:`${100*(y1-y0)/height}%`,borderColor:last.fallback?'#ff725e':'#60e1a1'});}
    };
    const events=event=>Promise.all(apis.map((api,i)=>sessions[i]?api('/event',{sessionId:sessions[i],...event}):null));
    const haltCamera=()=>{
      running=false;generation++;
      if(callback!==undefined)video.cancelVideoFrameCallback(callback);
      stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;sync();
    };
    const infer=async(ticket,metadata)=>{
      canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.drawImage(video,0,0);
      const request={captureId:crypto.randomUUID(),captureEpochMs:Date.now(),handedness,
        acquisitionMode:'detector',cropPadding:1.4,detectorThreshold:.18,
        cropBox:cameraCrop(canvas.width,canvas.height),pixelBasis:'unmirrored_camera',
        clock:'browser_sample_not_sensor_exposure',videoFrameMetadata:metadata,
        image:canvas.toDataURL('image/jpeg',.95).split(',')[1]};
      const retained={captureId:request.captureId,request,identities,outcome:{state:'submitted',comparison:true}};
      await captures.put(retained);
      let results;
      try{
        results=await sharedInference(apis,sessions,request);
        const positions=pairedPrediction(results,request,identities);
        const imageSource='data:image/jpeg;base64,'+request.image;
        const decoded=document.createElement('img');decoded.src=imageSource;await decoded.decode();
        await captures.put({...retained,outcome:{state:'computed',results}});
        if(ticket!==generation||disposed){await events({kind:'pair_not_presented_after_stop',captureId:request.captureId,epochMs:Date.now()});return;}
        // Both results validated first; a render can never observe a half-updated pair.
        positions.forEach((position,i)=>{
          const geometry=meshes[i].geometry;
          geometry.setAttribute('position',new BufferAttribute(position,3));
          geometry.setIndex(health[i].faces.flatMap(f=>request.handedness==='left'?[f[0],f[2],f[1]]:f));
          geometry.computeVertexNormals();geometry.computeBoundingSphere();meshes[i].visible=true;
        });
        sample.src=imageSource;sample.dataset.captureId=request.captureId;
        received++;last={captureId:request.captureId,captureEpochMs:request.captureEpochMs,cropBox:results[0].cropBox,imageSize:[canvas.width,canvas.height],
          fallback:results[0].acquisitionDetails.fallback,outputs:results.map(r=>r.output),
          identities:results.map(r=>r.identity),view:scene.readView()};
        scene.redraw();sync();
        await events({kind:'pair_presented',...last,epochMs:Date.now(),display:{scale:5,invertY:true,anchor:'mesh_joint_wrist'}});
      }catch(cause){
        await captures.put({...retained,outcome:{state:'failed',results,error:String(cause),epochMs:Date.now()}});
        throw cause;
      }
    };
    const schedule=ticket=>{
      if(!running||disposed||ticket!==generation)return;
      callback=video.requestVideoFrameCallback((now,metadata)=>{
        flight=infer(ticket,metadata).catch(async cause=>{
          error=String(cause);haltCamera();
          await events({kind:'pair_failure',error,epochMs:Date.now()}).catch(()=>{});
        }).finally(()=>{flight=null;schedule(ticket);});
      });
    };
    const frame=()=>scene.setView({position:[0,1.7,5],target:[0,1.7,0]});
    const stop=async()=>{
      haltCamera();if(flight)await flight.catch(()=>{});
      await events({kind:'pair_stop',epochMs:Date.now(),captureId:last?.captureId??null});
      record({kind:'hand-pair.stop',phase:'applied',effective:read()});return read();
    };
    const start=async()=>{
      if(running||starting)return read();if(disposed)throw Error('experiment closed');
      if(flight)await flight;starting=true;error=null;const ticket=++generation;sync();
      try{
        sessions=[];
        for(const api of apis){const s=await api('/session',{source:'paired_browser_camera',handedness,pixelBasis:'unmirrored_camera'});sessions.push(s.sessionId);}
        if(disposed||ticket!==generation)return read();
        const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480}},audio:false});
        if(disposed||ticket!==generation){acquired.getTracks().forEach(t=>t.stop());return read();}
        stream=acquired;video.srcObject=stream;await video.play();
        if(disposed||ticket!==generation){stream?.getTracks().forEach(t=>t.stop());return read();}
        running=true;received=0;last=null;sample.removeAttribute('src');delete sample.dataset.captureId;
        meshes.forEach(m=>m.visible=false);scene.redraw();schedule(ticket);
        record({kind:'hand-pair.start',phase:'applied',effective:read()});return read();
      }catch(cause){error=String(cause);haltCamera();throw cause;}
      finally{starting=false;sync();}
    };
    frame();const unsubscribe=scene.onFrame(sync);
    return {read,operations:{start,stop,frame},
      mount({root,document,invoke}){
        const intro=document.createElement('p');intro.textContent='Original left · Trained right. Same camera frame and crop. Wrist aligned, equal scale.';
        const preview=document.createElement('div');preview.style.cssText='position:relative;overflow:hidden';
        overlay=document.createElement('div');overlay.style.cssText='position:absolute;border:2px solid #60e1a1;pointer-events:none;box-sizing:border-box';preview.append(video,sample,overlay);
        const sourceLabel=document.createElement('div');sourceLabel.textContent='Matched camera sample';
        select=document.createElement('select');select.setAttribute('aria-label','Hand');
        for(const side of ['right','left']){const o=document.createElement('option');o.value=side;o.textContent=side==='right'?'Right hand':'Left hand';select.append(o);}
        select.value=handedness;select.onchange=()=>{handedness=select.value;};
        const failed=cause=>{error=String(cause);sync();};
        button=document.createElement('button');button.onclick=()=>invoke(running?'stop':'start').catch(failed);
        const frameButton=document.createElement('button');frameButton.textContent='Frame both hands';frameButton.onclick=()=>invoke('frame').catch(failed);
        status=document.createElement('div');status.setAttribute('role','status');status.dataset.handPairStatus='';status.style.overflowWrap='anywhere';
        root.append(intro,sourceLabel,preview,select,button,frameButton,status);sync();
      },
      async dispose(){disposed=true;unsubscribe();try{await stop();}finally{captures.close();await scene.dispose();}},
    };
  },
};
