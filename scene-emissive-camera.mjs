import {cameraWhiteBalance} from './volume-emissive-transport.mjs';

// The matched scene control is a second editor for the flame camera's EV.
// The independent scene exposure stays with its renderer for later unmatching.
export function bindSceneExposureControls({exposure,flame,match,label,output,readIndependent,writeIndependent,redraw}) {
  const bounds=Object.fromEntries(['min','max','step'].map(key=>[key,exposure[key]]));
  const event=type=>new flame.ownerDocument.defaultView.Event(type,{bubbles:true});
  const sync=({force=false}={})=>{
    const independent=readIndependent();
    exposure.min=match.checked?flame.min:String(Math.min(Number(bounds.min),independent));
    exposure.max=match.checked?flame.max:String(Math.max(Number(bounds.max),independent));
    exposure.step=match.checked?flame.step:'any';
    const value=match.checked?Number(flame.value):independent;
    const typing=exposure.type==='number'&&exposure.readOnly===false&&exposure.ownerDocument.activeElement===exposure;
    if(force||!typing)exposure.value=String(value);
    label.textContent=match.checked?'Exposure EV':'Exposure';
    output.textContent=value.toFixed(2);
  };
  const check=state=>{
    if(typeof state.matched!=='boolean'||!Number.isFinite(state.independent)||state.independent<0||
      !Number.isFinite(state.flameEV)||state.flameEV<Number(flame.min)||state.flameEV>Number(flame.max))throw Error('Invalid camera exposure state');
    if(!Number.isFinite(state.value))throw Error('Invalid camera exposure value');
    const next={...state,...(state.matched?{flameEV:state.value}:{independent:state.value})};
    if(next.flameEV<Number(flame.min)||next.flameEV>Number(flame.max)||next.independent<0)throw Error('Invalid camera exposure value');
    return next;
  };
  exposure.addEventListener('input',()=>{
    if(exposure.value===''||!Number.isFinite(Number(exposure.value)))return;
    const value=Number(exposure.value);
    if(match.checked){flame.value=String(value);flame.dispatchEvent(event('input'));}
    else writeIndependent(value);
    sync();redraw();
  });
  flame.addEventListener('input',sync);flame.addEventListener('change',sync);
  exposure.addEventListener('change',()=>sync({force:true}));
  exposure.addEventListener('blur',()=>sync({force:true}));
  match.addEventListener('change',()=>{sync({force:true});redraw();});
  return {sync,check,
    read:()=>({value:match.checked?Number(flame.value):readIndependent(),matched:match.checked,independent:readIndependent(),flameEV:Number(flame.value)}),
    write(state){state=check(state);writeIndependent(state.independent);match.checked=state.matched;flame.value=String(state.flameEV);flame.dispatchEvent(event('input'));sync({force:true});redraw();},
  };
}

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

export function applySceneEmissiveCamera(pipeline,raw,matched,effective,{linearIntermediate=false}={}) {
  // Refraction consumes radiance. A matched camera node already contains its
  // display transform, independently of outputColorTransform on the pipeline.
  const output=effective&&!linearIntermediate?matched:raw,transform=!effective&&!linearIntermediate;
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
