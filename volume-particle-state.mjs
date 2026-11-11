// Composition is (fuel, heat, soot, oxidizer); position and optical history stay
// in the existing 96-byte record. The lifetime clock is representation state.
export const PARTICLE_STATE_DEFAULTS=Object.freeze({materialStateVersion:1,exchangeStrength:1,exchangeTime:8,exchangeCellSize:1,stateLife:1,lifeFuel:24,lifeHeat:24,lifeSmoke:48,lifeQuiet:6,lifeFade:.2,followFraction:.75,followJitter:.25,followFuel:1,followHeat:1,followSmoke:1,debugView:0,emissionFalloff:1,extinctionFalloff:1,emissionEdgeSoftness:.2,extinctionEdgeSoftness:.3});
export const PARTICLE_STATE_WGSL=/* wgsl */`
struct ParticleReactionResult {state:vec4<f32>,burned:f32}
fn particleSootBurnout(state:vec4<f32>,dt:f32,rate:f32,kelvinPerHeat:f32,threshold:f32)->f32{
 let gate=smoothstep(threshold-150.0,threshold+150.0,300.0+max(0.0,state.y)*kelvinPerHeat);
 return state.z*exp(-max(0.0,rate)*max(0.0,dt)*clamp(state.w,0.0,1.0)*gate);
}
fn particleCompositionBurn(state:vec4<f32>,dt:f32,chemistry:vec4<f32>,rates:vec4<f32>)->ParticleReactionResult {
 if(dt<=0){return ParticleReactionResult(state,0.0);}
 let fuel=max(0.0,state.x);let heat=max(0.0,state.y);let soot=max(0.0,state.z);let oxygen=max(0.0,state.w);
 let burned=min(fuel,oxygen/max(chemistry.x,1e-20))*smoothstep(chemistry.z,chemistry.w,heat)*(1.0-exp(-dt/rates.x));
 return ParticleReactionResult(vec4<f32>(max(0.0,fuel-burned),(heat+chemistry.y*burned)*exp(-dt/rates.y),(soot+rates.z*burned)*exp(-dt/rates.w),max(0.0,oxygen-chemistry.x*burned)),burned);
}
fn particleLifeFade(clock:f32,fade:f32)->f32 {
 if(fade<=0){return select(1.0,0.0,clock>=1.0);}
 return 1.0-smoothstep(1.0-fade,1.0,clock);
}
fn particleLifeAdvance(state:vec4<f32>,initialFuel:f32,clock:f32,dt:f32,lives:vec4<f32>,ignition:vec2<f32>,sootReference:f32,strength:f32,fade:f32)->vec4<f32>{
 let fuel=clamp(state.x/max(initialFuel,1e-20),0.0,1.0);
 let hot=smoothstep(ignition.x,ignition.y,state.y);let smoke=clamp(state.z/max(sootReference,1e-20),0.0,1.0);
 let quiet=1.0-max(fuel,max(hot,smoke));let weights=vec4<f32>(fuel,hot,smoke,quiet);
 let lifetime=dot(weights,lives)/dot(weights,vec4<f32>(1));
 let next=min(1.0,max(0.0,clock)+max(0.0,dt)*strength/lifetime);
 return vec4<f32>(next,select(1.0,particleLifeFade(next,fade),strength>0),lifetime,select(0.0,1.0,next>=1.0&&strength>0));
}
`;

export function validateParticleStateSettings(s){
 if(s.materialStateVersion!==1)throw Error("Unsupported particle material-state version");
 for(const k of ['exchangeStrength','stateLife','lifeFade','followFraction','emissionEdgeSoftness','extinctionEdgeSoftness'])if(!(s[k]>=0&&s[k]<=1))throw Error('Particle '+k+' must be between zero and one');
 for(const k of ['exchangeTime','exchangeCellSize','lifeFuel','lifeHeat','lifeSmoke','lifeQuiet','emissionFalloff','extinctionFalloff'])if(!(s[k]>0&&Math.fround(s[k])>0))throw Error('Particle '+k+' must be positive');
 if(!Number.isInteger(s.debugView)||s.debugView<0||s.debugView>7)throw Error('Unknown particle material view');
 return s;
}

const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function particleLifeAdvance({state,initialFuel,clock,dt,lives,ignition,sootReference,strength=1,fade=.2}){
 const w=[Math.max(0,Math.min(1,state[0]/Math.max(initialFuel,1e-20))),smooth(...ignition,state[1]),Math.max(0,Math.min(1,state[2]/Math.max(sootReference,1e-20)))];w.push(1-Math.max(...w));
 const lifetime=w.reduce((sum,v,i)=>sum+v*lives[i],0)/w.reduce((a,b)=>a+b,0),next=Math.min(1,Math.max(0,clock)+Math.max(0,dt)*strength/lifetime);
 return {clock:next,fade:strength>0?(fade>0?1-smooth(1-fade,1,next):Number(next<1)):1,lifetime,expired:next>=1&&strength>0};
}

export const PARTICLE_KERNEL_WGSL=/* wgsl */`
fn particleKernel(local:vec2<f32>,falloff:f32,softness:f32,normalization:f32)->f32 {
 let r=abs(local);let base=exp(-.5*(pow(r.x,2.0*falloff)+pow(r.y,2.0*falloff)));
 var edge=vec2<f32>(1);if(softness>0){edge=vec2<f32>(1)-smoothstep(vec2<f32>(2.5*(1.0-softness)),vec2<f32>(2.5),r);}
 return base*edge.x*edge.y*normalization;
}
`;

// Integrate the declared finite 1D profile. Adaptive subdivision stops at a
// relative/absolute numerical tolerance or floating-point spatial resolution.
function integral(fn,a,b,tolerance=1e-8){
 const simpson=(lo,hi,fa,fm,fb)=>(hi-lo)*(fa+4*fm+fb)/6;
 const mid=(a+b)/2,fa=fn(a),fm=fn(mid),fb=fn(b);let total=0;
 const stack=[[a,b,fa,fm,fb,simpson(a,b,fa,fm,fb),tolerance]];
 while(stack.length){const [lo,hi,l,m,r,whole,tol]=stack.pop(),center=(lo+hi)/2,left=(lo+center)/2,right=(center+hi)/2;
  if(left===lo||right===hi){total+=whole;continue;}
  const fl=fn(left),fr=fn(right),one=simpson(lo,center,l,fl,m),two=simpson(center,hi,m,fr,r),delta=one+two-whole;
  if(Math.abs(delta)<=15*tol){total+=one+two+delta/15;}else{stack.push([center,hi,m,fr,r,two,tol/2],[lo,center,l,fl,m,one,tol/2]);}
 }return total;
}
const baseIntegral=2*integral(x=>Math.exp(-.5*x*x),0,2.5),normalizations=new Map();
export function particleKernelNormalization(falloff,softness){
 const key=falloff+':'+softness;if(normalizations.has(key))return normalizations.get(key);
 if(!(falloff>0&&Number.isFinite(falloff)&&softness>=0&&softness<=1))throw Error('Invalid particle kernel profile');
 const edge=2.5*(1-softness),fn=x=>Math.exp(-.5*Math.abs(x)**(2*falloff))*(softness>0?1-smooth(edge,2.5,x):1);
 const value=2*(integral(fn,0,edge)+(edge<2.5?integral(fn,edge,2.5):0)),gain=(baseIntegral/value)**2;
 normalizations.set(key,gain);return gain;
}
