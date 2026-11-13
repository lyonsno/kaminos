import {createHandInput} from './hand-input-state.mjs';
import {mountHandInput} from './hand-input-ui.mjs';
import {createHandInputView} from './hand-input-view.mjs';
import {createHandMeshApp} from './models/mobrecon/hand-mesh-app.js';
import {openBrowserCaptureStore} from './hand-input-retention.mjs';

async function api(action,body,signal) {
  const response=await fetch('/api/hand-input'+(action?'/'+action:''),body?{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal,
  }:{cache:'no-store',signal});
  const value=await response.json();
  if(!response.ok)throw Error(value.error??`Hand input HTTP ${response.status}`);
  return value;
}
export function installHandInput({document,scene,camera,onFrame,redraw,getGpu}) {
  const view=createHandInputView({scene,camera,onFrame,redraw});
  let backend=null,retention=null,sessionId=null,config=null;
  const record={
    async begin(frame,state){
      retention.check();
      const captureId=sessionId+'_'+frame.frameId;
      frame.captureId=captureId;
      frame.retention=retention.begin({captureId,epochMs:Date.now(),identity:state.identity,configuration:state,
        request:{sessionId,width:frame.width,height:frame.height,frameId:frame.frameId,capturedAt:frame.capturedAt,mediaTime:frame.mediaTime}},await createImageBitmap(frame.source));
      frame.retention.catch(()=>{});
    },
    async finish(frame,outcome){if(frame?.captureId)retention.finish(frame.captureId,outcome);},
    async close(){const old=retention;retention=null;await old?.close();},
  };
  const input=createHandInput({record,
    async openCamera(){
      config=await api('');
      if(config.error)throw Error(config.error);
      if(!retention){sessionId=crypto.randomUUID();retention=await openBrowserCaptureStore({onFailure:error=>{void input.fail(error).catch(()=>{});}});}
      const video=document.createElement('video');video.muted=true;video.playsInline=true;
      const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
      let callback=null,stopped=false;
      try{video.srcObject=stream;await video.play();}
      catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
      return {
        schedule(fn){if(stopped)return;if(callback!==null)video.cancelVideoFrameCallback(callback);callback=video.requestVideoFrameCallback(()=>{callback=null;void fn();});},
        async frame(){if(stopped)throw Error('Hand camera stopped');const source=await createImageBitmap(video);return {source,width:source.width,height:source.height,mediaTime:video.currentTime,close:()=>source.close()};},
        stop(){if(stopped)return;stopped=true;if(callback!==null)video.cancelVideoFrameCallback(callback);stream.getTracks().forEach(track=>track.stop());video.pause();video.srcObject=null;},
      };
    },
    async loadModel(model,{signal,onProgress}){
      if(model==='wilor'){
        if(!config.wilor.available)throw Error(config.wilor.reason);
        const nativeId=crypto.randomUUID();let closed=false;
        const close=async()=>{if(closed)return;closed=true;await api('close',{sessionId:nativeId});};
        const cancel=()=>{void close().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
        try{
          const loaded=await api('open',{sessionId:nativeId},signal);
          if(loaded.identity?.backend!=='mlx-metal'||loaded.identity?.model!=='wilor')throw Error('Unexpected native hand model route');
          if(signal.aborted)throw new DOMException('Hand loading stopped','AbortError');
          const route={model,identity:loaded.identity,faces:loaded.faces,
            async infer({getFrame,sides}){
              const frame=await getFrame();await frame.retention;
              const result=await api('infer',{sessionId:nativeId,captureSessionId:sessionId,captureId:frame.captureId,sides,threshold:.3,frameId:frame.frameId,width:frame.width,height:frame.height});
              if(result.frameId!==frame.frameId||result.identity?.weightsSha256!==loaded.identity.weightsSha256)throw Error('Native hand response identity differs from the current frame/model');
              return result;
            },stop(){},async destroy(){signal.removeEventListener('abort',cancel);await close();}};
          backend=route;return route;
        }catch(error){signal.removeEventListener('abort',cancel);await close();throw error;}
      }
      const chosen=config.packages[model],detector=config.packages.detector;
      if(!chosen?.available||!detector?.available)throw Error(`${model} and the hand detector must be installed in ${config.installationFile}`);
      const gpu=await getGpu();if(!gpu)throw Error('Hand input requires the page WebGPU device');
      // Use the host's run entry so it installs the foreground frame requester.
      const foreground=Object.create(gpu.foreground,{beginRun:{value:gpu.beginRun.bind(gpu)}});
      const app=await createHandMeshApp({session:await gpu.session(),foreground,device:gpu.device,
        mobreconPackageUrl:chosen.url,detectorPackageUrl:detector.url,onProgress,load:false});
      const cancel=()=>{void app.destroy().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
      try{
        await app.load();
        const expected='mobrecon.densestack-'+model;
        if(app.identity.mobrecon.modelId!==expected)throw Error(`Requested ${model}, received ${app.identity.mobrecon.modelId}`);
        const route={model,identity:app.identity,faces:app.faces,
          async infer({getFrame,sides}){
            const result=await app.infer({getFrame,sides,acquisition:{mode:'detector',padding:1.4,threshold:.3,onMiss:'skip'}});
            return {...result,imageSize:[result.input.width,result.input.height]};
          },stop:()=>app.stop(),async destroy(){signal.removeEventListener('abort',cancel);await app.destroy();}};
        backend=route;return route;
      }catch(error){signal.removeEventListener('abort',cancel);await app.destroy();throw error;}
    },
    present:result=>view.present(result,backend?.faces),clear:()=>view.clear(),
  });
  const ui=mountHandInput({document,input,before:document.getElementById('authoring-search')});
  const gone=()=>{void input.dispose();};document.defaultView.addEventListener('pagehide',gone,{once:true});
  return {...input,openSettings:ui.open,closeSettings:ui.close,visualization:view.read,
    async dispose(){document.defaultView.removeEventListener('pagehide',gone);await input.dispose();ui.dispose();view.dispose();}};
}
