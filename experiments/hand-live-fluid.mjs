import {Vector3} from '../lib/three.core.js';

export const NATIVE_FINGER_ROUTE='mobrecon-native-mesh-finger-juice-v1';
export const MAX_SAMPLE_AGE_MS=750;
const names=['thumb','index','middle','ring','pinky'];
const clamp=x=>Math.max(0,Math.min(1,x));
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const length=a=>Math.hypot(...a);
const cosine=(a,b)=>length(a)*length(b)>1e-8?a.reduce((n,v,i)=>n+v*b[i],0)/(length(a)*length(b)):-1;

// Palm's distal-axis/full-extension v1 rule, from LERMS live-finger-fluid.ts.
// Only placement changes: the mesh and water now share one world and camera.
export function nativeFingerPacket(frame,{nowMs,running,center,matrix,sourceFlux=360}) {
  if(frame.source!=='mobrecon_densestack_spiralconv'||frame.jointBasis!=='upstream_j_reg_mano_to_mpii')throw Error('Unsupported native joint basis');
  const points=frame.meshJointsMeters;
  if(!Array.isArray(points)||points.length!==21||points.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw Error('Invalid mesh joints');
  if(!Number.isFinite(nowMs)||!Number.isFinite(frame.captureEpochMs)||!Number.isFinite(sourceFlux)||sourceFlux<0)throw Error('Invalid inlet clock or flux');
  if(!center?.every(Number.isFinite)||center.length!==3||!matrix?.elements?.every(Number.isFinite))throw Error('Invalid mesh placement');
  const age=nowMs-frame.captureEpochMs;
  const reason=!running?'camera_stopped':age<0?'future_sample':age>MAX_SAMPLE_AGE_MS?'stale_sample':frame.acquisitionDetails?.fallback?'no_detection_fallback':null;
  const world=p=>new Vector3(p[0]-center[0],-(p[1]-center[1]),p[2]-center[2]).applyMatrix4(matrix);
  const emitters=names.map((id,f)=>{
    const chain=points.slice(1+4*f,5+4*f),segments=chain.slice(1).map((p,i)=>sub(p,chain[i]));
    const total=segments.reduce((n,s)=>n+length(s),0);
    const reach=total>1e-6?length(sub(chain[3],chain[0]))/total:0;
    const straightness=Math.min(cosine(segments[0],segments[1]),cosine(segments[1],segments[2]));
    const extension=clamp(Math.min(clamp((reach-.72)/.25),clamp((straightness-.68)/.3)));
    const origin=world(chain[3]),direction=origin.clone().sub(world(chain[2])).normalize();
    const active=!reason&&extension>=.86;
    return {id,extension,active,emission_state:active?'jet':'off',origin_world:origin.toArray(),aim_world:direction.toArray(),
      radius:(id==='middle'?.052:.044)*1.6,strength:1.15*1.7,lifetime_seconds:6,
      optical_density_scale:1.7,reconstruction_radius_scale:1.6,
      chemistry:f===0?'splash':f===1?'knockback':f===2?'pooling':'weird'};
  });
  const count=Math.max(1,emitters.filter(e=>e.active).length);
  for(const emitter of emitters)emitter.source_flux_particles_per_second=emitter.active?sourceFlux/count:0;
  return {packet_id:`native-finger-${frame.captureId}-${reason??'live'}`,route_identity:NATIVE_FINGER_ROUTE,
    source_route:NATIVE_FINGER_ROUTE,source_frame_id:frame.captureId,timestamp_ms:frame.captureEpochMs,sample_age_ms:age,
    adapter_contract:'hand-state-distal-axis-full-extension-emitters-v1',
    interaction_scope:'operator_finger_juice_experiment_not_world_registration',
    simulation_authority:reason?'invalid':'live_simulation',authority:{simulation_safe:!reason,stale:age>MAX_SAMPLE_AGE_MS,reason},
    economics:{requestedParticleCount:2400,requestedActiveParticleBudget:720,sourceFluxParticlesPerSecond:sourceFlux,
      opticalDensityScale:1.7,reconstructionRadiusScale:1.6,lifetimeSeconds:6,fallbackActive:false},emitters};
}

export function idleFingerPacket(reason='no_sample') {
  return {packet_id:`native-finger-${reason}`,route_identity:NATIVE_FINGER_ROUTE,source_route:NATIVE_FINGER_ROUTE,
    simulation_authority:'invalid',authority:{simulation_safe:false,stale:false,reason},emitters:[]};
}
