import * as THREE from './lib/three.webgpu.js';
import {cubeCoordinates} from './fire-cube-coordinates.mjs';

export function shadowBankPlan({count,resolution},limits={}) {
  if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(resolution)||resolution<1)throw Error('positive shadow bank count/resolution required');
  const layers=count*6,bytes=resolution*resolution*layers*8;
  const supported=Number.isSafeInteger(bytes)&&layers<=(limits.maxTextureArrayLayers??0)&&resolution<=(limits.maxTextureDimension2D??0);
  return {count,resolution,layers,bytes,supported,reason:supported?null:'texture-array-capacity'};
}

// Captures keep their ordinary cube targets. Copy only the newly completed
// six-face targets into a shared sampled array, preserving retained anchors.
export function createFireShadowBank({renderer,count,resolution}) {
  const device=renderer.backend?.device;
  if(!renderer.backend?.isWebGPUBackend||typeof renderer.initTexture!=='function'||!shadowBankPlan({count,resolution},device.limits).supported)return null;
  const texture=new THREE.StorageArrayTexture(resolution,resolution,count*6);
  texture.name='Indexed retained solid shadow bank';texture.type=THREE.HalfFloatType;
  texture.format=THREE.RGBAFormat;texture.colorSpace=THREE.NoColorSpace;
  texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.flipY=false;
  let ready=false,disposed=false,lastIndices=[],copyBytes=0,submissions=0;
  const init=()=>{texture.needsUpdate=true;renderer.initTexture(texture);};init();
  return {
    texture,
    sampleDepth(index,ray){
      if(disposed)throw Error('shadow bank disposed');
      const {vec3,int,texture:sample}=THREE.TSL;
      // Match CubeTextureNode's WebGPU camera convention, without environment rotation.
      const direction=renderer.coordinateSystem===THREE.WebGPUCoordinateSystem?vec3(ray.x.negate(),ray.yz):ray;
      const p=cubeCoordinates(direction);
      return sample(texture,p.xy).depth(int(index).mul(6).add(int(p.z))).level(0).r;
    },
    setResolution(value){
      if(disposed)throw Error('shadow bank disposed');
      const plan=shadowBankPlan({count,resolution:value},device.limits);
      if(!plan.supported)throw Error('shadow bank resolution exceeds texture capacity');
      if(value===resolution)return;
      resolution=value;ready=false;lastIndices=[];copyBytes=0;
      texture.setSize(resolution,resolution,count*6);init();
    },
    copyCompleted(indices,shadows){
      if(disposed)throw Error('shadow bank disposed');
      if(shadows.length!==count||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=count))throw Error('invalid shadow bank copy selection');
      if(!ready&&indices.length!==count)throw Error('shadow bank requires a complete initial capture');
      const destination=renderer.backend.get(texture).texture;
      if(!destination||destination.width!==resolution||destination.height!==resolution||destination.depthOrArrayLayers!==count*6||destination.format!=='rgba16float')throw Error('shadow bank allocation mismatch');
      const sources=indices.map(i=>{
        const r=shadows[i].resource(),t=r.texture;
        if(!r.effective||!t||t.width!==resolution||t.height!==resolution||t.depthOrArrayLayers!==6||t.format!==destination.format)throw Error('shadow bank requires matching completed cube faces');
        return t;
      });
      if(indices.length){
        const encoder=device.createCommandEncoder({label:'copy refreshed solid cubes into indexed bank'});
        indices.forEach((i,k)=>encoder.copyTextureToTexture({texture:sources[k]},{texture:destination,origin:[0,0,i*6]},[resolution,resolution,6]));
        device.queue.submit([encoder.finish()]);submissions++;
      }
      ready=true;lastIndices=[...indices];copyBytes=indices.length*resolution*resolution*6*8;
      return this.debugState();
    },
    debugState(){return {...shadowBankPlan({count,resolution},device.limits),strategy:'indexed-array',status:ready?'submitted':'awaiting-complete-capture',lastIndices:[...lastIndices],copyBytes,submissions};},
    dispose(){if(disposed)return;disposed=true;ready=false;texture.dispose();},
  };
}
