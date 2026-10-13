import {cameraWhiteBalance} from './volume-emissive-transport.mjs';

// Display-only comparison. Never alter raw emission, extinction or light gain.
export function resolveSceneEmissiveCamera(requested, physical) {
  const base={requested:!!requested,effective:false,transform:'host-camera'};
  if(!requested)return {...base,reason:'comparison-off'};
  if(physical?.effective!=='emissive-transport-v2')return {...base,reason:'requires-effective-emissive-transport-v2'};
  const {exposureEV,highlightKnee,whiteBalanceKelvin}=physical;
  const toneMapping = physical.toneMapping ?? 'agx';
  if(![exposureEV,highlightKnee,whiteBalanceKelvin].every(Number.isFinite)||highlightKnee<0||highlightKnee>=1||whiteBalanceKelvin<=0)
    return {...base,reason:'invalid-effective-camera-state'};
  return {...base,effective:true,reason:null,transform:toneMapping === 'agx' ? 'agx-rec2020-default-srgb-v1' : 'fixed-bradford-white-channel-shoulder-srgb-v4',toneMapping,exposureEV,highlightKnee,whiteBalanceKelvin};
}

export function applySceneEmissiveCamera(pipeline,raw,matched,effective) {
  const output=effective?matched:raw,transform=!effective;
  if(pipeline.outputNode!==output||pipeline.outputColorTransform!==transform) {
    pipeline.outputNode=output;pipeline.outputColorTransform=transform;pipeline.needsUpdate=true;
  }
}

export function createSceneEmissiveCamera(input,{TSL,THREE}) {
  const {uniform,vec3,vec4,float,Fn,agxToneMapping}=TSL;
  const exposure=uniform(1),knee=uniform(.6),agx=uniform(1);
  const rows=[0,1,2].map(i=>uniform(new THREE.Vector3(...[0,1,2].map(j=>Number(i===j)))));
  const outputNode=Fn(()=>{
    // Materialize the shared camera input before the color/transfer branches.
    const incoming=input.toVar();
    const alpha=incoming.a.clamp(0,1).toVar();
    const straight=incoming.rgb.div(alpha.max(1e-6)).toVar();
    const balanced=vec3(...rows.map(row=>row.dot(straight))).toVar();
    const exposed=balanced.mul(exposure).max(0).toVar(),d=float(1).sub(knee);
    const shoulder=vec3(1).sub(d.mul(d).div(exposed.add(float(1).sub(knee.mul(2))).max(d)));
    const custom=exposed.greaterThan(knee).select(shoulder,exposed);
    const linear=agx.greaterThan(.5).select(agxToneMapping(balanced,exposure),custom).toVar();
    const srgb=linear.lessThanEqual(.0031308).select(linear.mul(12.92),linear.pow(1/2.4).mul(1.055).sub(.055));
    return vec4(srgb.mul(alpha),alpha);
  })();
  let state=resolveSceneEmissiveCamera(false),lastWhite=null;
  return {outputNode,
    update(requested,physical) {
      state=resolveSceneEmissiveCamera(requested,physical);
      if(state.effective) {
        exposure.value=2**state.exposureEV;knee.value=state.highlightKnee;
        agx.value=Number(state.toneMapping === 'agx');
        if(lastWhite!==state.whiteBalanceKelvin) {
          cameraWhiteBalance(state.whiteBalanceKelvin).forEach((row,i)=>rows[i].value.set(...row));
          lastWhite=state.whiteBalanceKelvin;
        }
      }
      return state;
    },debugState:()=>({...state}),
  };
}
