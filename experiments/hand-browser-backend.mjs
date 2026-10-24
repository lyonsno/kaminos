import {createWebGpuInferenceSession} from '../webgpu-inference-kit/src/core.js';
import {createBrowserHandMeshRoute} from '../models/mobrecon/hand-mesh-route.js';
import {readServedModels} from '../demos/hand-mesh/model-files.js';
import {browserIdentity,browserHandFrame,JOINT_REGRESSOR_SHA} from './hand-browser-contract.mjs';
import {startHandRecording} from './hand-browser-recording.mjs';

export async function openBrowserHandBackend({host,inputs}){
  const renderer=host.scene.renderer();
  await renderer.init();
  if(!renderer.backend.isWebGPUBackend||!renderer.backend.device)throw Error('Browser hand requires the shared WebGPU renderer');
  const models=await readServedModels(inputs.models??'/__hand-models/');
  const response=await fetch('/__hand-models/joints.json');
  if(!response.ok)throw Error('Upstream mesh-joint regressor unavailable');
  const joints=await response.json();
  if(joints.sourceSha256!==JOINT_REGRESSOR_SHA||joints.basis!=='upstream_j_reg_mano_to_mpii')throw Error('Unrecognized mesh-joint regressor');
  const session=await createWebGpuInferenceSession({sessionId:crypto.randomUUID(),device:renderer.backend.device,
    adapter:renderer.backend.adapter,deviceOwnership:'borrowed',adapterName:'Kaminos shared hand and water device'});
  let route,recording;
  try{
    route=await createBrowserHandMeshRoute({session,mobreconPackageSource:models.mobrecon,detectorPackageSource:models.detector});
    const identity=browserIdentity(route.identity,joints.sourceSha256);
    const retain=async(kind,payload)=>{
      const response=await fetch('/api/hand-record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,payload})});
      if(!response.ok)throw Error(`Hand evidence retention failed: HTTP ${response.status}`);
    };
    return {
      retain:capture=>retain('capture',capture),
      startRecording(sessionId){
        if(recording)throw Error('Hand recording already active');
        recording=startHandRecording({canvas:renderer.domElement,write:async(blob,part)=>{
          const response=await fetch(`/api/hand-video?session=${sessionId}&part=${part}`,{method:'POST',body:blob});
          if(!response.ok)throw Error(`Rendered hand retention failed: HTTP ${response.status}`);
        }});
        return retain('event',{sessionId,kind:'rendered_recording_start',epochMs:Date.now(),mimeType:recording.mimeType});
      },
      async stopRecording(){const owned=recording;recording=null;return owned?.stop();},
      async api(path,request,source){
        if(path==='/health')return {status:'loaded',identity,interactionAuthority:false,faces:Array.from({length:1538},(_,i)=>Array.from(route.faces.slice(3*i,3*i+3)))};
        if(path==='/session'){
          const sessionId=crypto.randomUUID();await retain('event',{...request,sessionId,kind:'session',identity});return {sessionId};
        }
        if(path==='/event'){await retain('event',request);return {retained:true};}
        if(path!=='/frame')throw Error('Unknown browser hand operation');
        recording?.check();
        const result=await route.infer({source,width:source.width,height:source.height,handedness:request.handedness,
          acquisition:{mode:request.acquisitionMode,padding:request.cropPadding,threshold:request.detectorThreshold,manualBox:request.cropBox,onMiss:'manual'}});
        return browserHandFrame(result,{captureId:request.captureId,captureEpochMs:request.captureEpochMs},joints.weights,joints.sourceSha256);
      },
      async close(){try{await recording?.stop();}finally{route.release();await session.close();}},
    };
  }catch(error){route?.release();await session.close();throw error;}
}
