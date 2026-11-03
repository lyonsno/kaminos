import {StorageBufferAttribute} from '../../lib/three.webgpu.js';
import {storage,Fn,wgslFn,instanceIndex,uint,float,uniform,mix} from '../../lib/three.tsl.js';
import {terrainConfig,makeRidges,ROUTE} from './model.mjs';

const init=wgslFn(`fn hill_initial(v:u32,n:u32,width:f32,length:f32,soil:f32,ridges:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let p=(vec2<f32>(f32(x),f32(z))/f32(n-1u)-vec2<f32>(.5))*vec2<f32>(width,length);var ridge=0.;
 for(var k=0u;k<arrayLength(ridges);k+=2u){let a=(*ridges)[k];let b=(*ridges)[k+1u];let d=b.xy-a.xy;let t=clamp(dot(p-a.xy,d)/dot(d,d),0.,1.);let r=p-a.xy-t*d;let w=mix(a.w,b.w,t);ridge=max(ridge,mix(a.z,b.z,t)*exp(-dot(r,r)/(2.*w*w)));}
 let grain=.5+.5*sin(p.x*2.1+.7*sin(p.y*1.4))*sin(p.y*1.8+p.x*.4);let edge=f32(min(min(x,z),min(n-1u-x,n-1u-z)))/f32(n-1u);let coast=min(1.,edge/.10);
 return vec4<f32>(.09+coast*(ridge*.78+.025*grain),coast*(.055+soil*(.3+.7*ridge/1.8)),0.,0.);
}`);
const flux=wgslFn(`fn hill_flux(v:u32,n:u32,dx:f32,dz:f32,talus:f32,fraction:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let s=(*state)[v];let h=s.x+s.y;var e=vec4<f32>(0.);
 if(x>0u){let a=(*state)[v-1u];e.x=max(0.,h-a.x-a.y-talus*dx);}if(x+1u<n){let a=(*state)[v+1u];e.y=max(0.,h-a.x-a.y-talus*dx);}
 if(z>0u){let a=(*state)[v-n];e.z=max(0.,h-a.x-a.y-talus*dz);}if(z+1u<n){let a=(*state)[v+n];e.w=max(0.,h-a.x-a.y-talus*dz);}
 let sum=e.x+e.y+e.z+e.w;if(sum<=0.){return vec4<f32>(0.);}return e*(min(s.y,sum*.25)*fraction/sum);
}`);
const move=wgslFn(`fn hill_move(v:u32,n:u32,width:f32,length:f32,dt:f32,uplift:f32,state:ptr<storage,array<vec4<f32>>,read_write>,flow:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let s=(*state)[v];let f=(*flow)[v];var incoming=0.;
 if(x>0u){incoming+=(*flow)[v-1u].y;}if(x+1u<n){incoming+=(*flow)[v+1u].x;}if(z>0u){incoming+=(*flow)[v-n].w;}if(z+1u<n){incoming+=(*flow)[v+n].z;}
 let p=(vec2<f32>(f32(x),f32(z))/f32(n-1u)-vec2<f32>(.5))*vec2<f32>(width,length);
 let bed=s.x+uplift*dt*exp(-((p.x+.4)*(p.x+.4))/3.-((p.y+1.5)*(p.y+1.5))/.5);
 let soil=max(0.,s.y+incoming-f.x-f.y-f.z-f.w);return vec4<f32>(bed,soil,(bed+soil-s.x-s.y)/dt,s.w);
}`);
const normal=wgslFn(`fn hill_normal(v:u32,n:u32,dx:f32,dz:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let l=(*state)[v-select(0u,1u,x>0u)];let r=(*state)[v+select(0u,1u,x+1u<n)];let b=(*state)[v-select(0u,n,z>0u)];let f=(*state)[v+select(0u,n,z+1u<n)];
 let gx=(r.x+r.y-l.x-l.y)/(dx*select(1.,2.,x>0u&&x+1u<n));let gz=(f.x+f.y-b.x-b.y)/(dz*select(1.,2.,z>0u&&z+1u<n));return vec4<f32>(normalize(vec3<f32>(-gx,1.,-gz)),0.);
}`);

const formedColor=wgslFn(`fn hill_geological_color(x:f32,z:f32,bed:f32,soil:f32,tilt:f32,fold:f32,thickness:f32,seed:f32)->vec4<f32>{
 let phase=(bed-tilt*x-fold*sin(z*.7+x*.2)+seed*.017)/thickness;
 let band=.5+.5*sin(phase*6.28318530718);
 let rock=mix(vec3<f32>(.13,.10,.065),vec3<f32>(.30,.245,.16),band);
 let earth=vec3<f32>(.12,.17,.065);let exposed=exp(-soil/.045);
 return vec4<f32>(mix(earth,rock,exposed),1.);
}`);

export function createTerrainGPU(geometry,input={}){
 let config=terrainConfig(input),ridges=makeRidges(config);const n=config.resolution,count=n*n,attributes=[],nodes=[];
 const attribute=(array,size,label)=>{const a=new StorageBufferAttribute(array,size);a.name='hill-'+label;attributes.push(a);return a;};
 const stateAttributes=[0,1].map(i=>attribute(new Float32Array(count*4),4,'state-'+i)),states=stateAttributes.map(a=>storage(a,'vec4',count));
 const flowAttribute=attribute(new Float32Array(count*4),4,'transport'),flows=storage(flowAttribute,'vec4',count);
 const ridgeAttribute=attribute(Float32Array.from(ridges.flatMap(e=>[...e.a,...e.b])),4,'initial-ridges'),ridgeNode=storage(ridgeAttribute,'vec4',ridges.length*2);
 const positions=attribute(new Float32Array(count*4),4,'positions'),normals=attribute(new Float32Array(count*4),4,'normals'),colors=attribute(new Float32Array(count*4),4,'colors');
 geometry.setAttribute('position',positions);geometry.setAttribute('normal',normals);geometry.setAttribute('color',colors);
 const displayAttribute=attribute(new Float32Array(count*4),4,'display-state'),displayState=storage(displayAttribute,'vec4',count),alpha=uniform(1);
 const interpolators=states.map((state,i)=>Fn(()=>{displayState.element(instanceIndex).assign(mix(states[1-i].element(instanceIndex),state.element(instanceIndex),alpha));})().compute(count));
 const positionNode=storage(positions,'vec4',count),normalNode=storage(normals,'vec4',count),colorNode=storage(colors,'vec4',count);
 const formedAttribute=attribute(new Float32Array(count*4),4,'formed-source'),formedNode=storage(formedAttribute,'vec4',count),useFormed=uniform(0);
 const geoTilt=uniform(.28),geoFold=uniform(.18),geoThickness=uniform(.32),geoSeed=uniform(47);
 const dt=uniform(.05),drive=uniform(config.uplift),talus=uniform(Math.tan(config.repose*Math.PI/180)),fraction=uniform(0),soil=uniform(config.soil);
 const initializers=states.map(state=>Fn(()=>{state.element(instanceIndex).assign(mix(init({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),soil,ridges:ridgeNode}),formedNode.element(instanceIndex),useFormed));})().compute(count));
 const solvers=states.map((state,i)=>[
  Fn(()=>{flows.element(instanceIndex).assign(flux({v:instanceIndex,n:uint(n),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),talus,fraction,state}));})().compute(count),
  Fn(()=>{states[1-i].element(instanceIndex).assign(move({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),dt,uplift:drive,state,flow:flows}));})().compute(count)
 ]);
 const publishers=states.map(()=>Fn(()=>{
  const state=displayState;
  const v=instanceIndex,s=state.element(v),x=v.mod(uint(n)).toFloat().div(n-1).sub(.5).mul(config.width),z=v.div(uint(n)).toFloat().floor().div(n-1).sub(.5).mul(config.length);
  positionNode.element(v).assign(initPosition(x,s.x.add(s.y),z));
  const norm=normal({v,n:uint(n),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),state});normalNode.element(v).assign(norm);
  // Soil cover and actual slope control the material, independent of world time.
  const cover=s.y.mul(4).clamp(0,1),steep=float(1).sub(norm.y).mul(1.3).clamp(0,1),exposed=steep.mul(float(1).sub(cover.mul(.4)));
  const legacyColor=initPosition(float(.30).add(exposed.mul(.12)).add(cover.mul(.05)),float(.36).sub(exposed.mul(.04)).add(cover.mul(.10)),float(.20).add(exposed.mul(.08)));
  colorNode.element(v).assign(mix(legacyColor,formedColor({x,z,bed:s.x,soil:s.y,tilt:geoTilt,fold:geoFold,thickness:geoThickness,seed:geoSeed}),useFormed));
 })().compute(count));
 nodes.push(...initializers,...solvers.flat(),...interpolators,...publishers);
 let renderer=null,initialized=false,index=0,steps=0,preparationSteps=0,seconds=0,disposed=false,pendingPresentation=true,generation=0,error=null,formationProvenance=null;
 const gpuError=e=>{error=e.error?.message??String(e);};
 function bind(r){
  if(disposed)throw Error('Hill simulator disposed');
  if(!r?.backend?.isWebGPUBackend||!r.backend.device)throw Error('Hill requires the actual host WebGPU renderer; no CPU fallback');
  if(renderer&&renderer!==r)throw Error('Hill renderer changed');if(!renderer){renderer=r;renderer.backend.device.addEventListener('uncapturederror',gpuError);renderer.backend.device.lost.then(info=>{if(!disposed)error=info.message||'Hill GPU device lost';});}
  const bytes=count*16,limits=r.backend.device.limits;if(bytes>limits.maxStorageBufferBindingSize||bytes>limits.maxBufferSize||Math.ceil(count/64)>limits.maxComputeWorkgroupsPerDimension)throw Error('Hill grid exceeds effective GPU limits');
  if(!initialized){renderer.compute(initializers);index=0;initialized=true;pendingPresentation=true;}
 }
 function flush(r){bind(r);if(error)throw Error(error);if(pendingPresentation){renderer.compute([interpolators[index],publishers[index]]);pendingPresentation=false;}}
 function advance(countSteps=1,{preparation=false}={}){
  if(!renderer||!initialized||disposed)throw Error('Hill GPU must be mounted before stepping');if(error)throw Error(error);
  if(!Number.isSafeInteger(countSteps)||countSteps<1)throw Error('Positive whole step count required');
  dt.value=.05;drive.value=preparation?0:config.uplift;talus.value=Math.tan(config.repose*Math.PI/180);fraction.value=1-Math.exp(-config.transport*dt.value);
  for(let j=0;j<countSteps;j++){renderer.compute(solvers[index]);index=1-index;if(preparation)preparationSteps++;else{steps++;seconds+=dt.value;}}
  pendingPresentation=true;return read();
 }
 function configure(patch){
  const next=terrainConfig({...config,...patch});for(const key of ['resolution','width','length'])if(next[key]!==config[key])throw Error('Grid changes require a new simulator instance');
  if(next.seed!==config.seed||next.layout!==config.layout||next.soil!==config.soil)throw Error('Initial conditions require regenerate');config=next;return read();
 }
 function regenerate(patch={}){const next=terrainConfig({...config,...patch});for(const key of ['resolution','width','length'])if(next[key]!==config[key])throw Error('Grid changes require a new simulator instance');config=next;formationProvenance=null;useFormed.value=0;ridges=makeRidges(config);ridgeAttribute.array.set(ridges.flatMap(e=>[...e.a,...e.b]));ridgeAttribute.needsUpdate=true;soil.value=config.soil;initialized=false;steps=0;preparationSteps=0;seconds=0;generation++;if(renderer)flush(renderer);return read();}
 function read(){return{route:ROUTE,backend:renderer?'webgpu':'unbound',initialized,config:{...config},generation,steps,preparationSteps,seconds,stateIndex:index,readbackInRuntime:false,error,representation:{kind:'height-material-grid',samples:count,triangles:(n-1)**2*2,bytes:attributes.reduce((s,a)=>s+a.array.byteLength,0),fields:['substrate_height','loose_depth','vertical_velocity','actor_memory']},capabilities:{initialConditions:true,prepare:true,advance:true,gpuSurface:true,actorHistoryIngress:false,fluidCoupling:false,cpuSurfaceQueries:false},provenance:formationProvenance??{seed:config.seed,layout:config.layout},clock:{dt:.05,displayAlpha:alpha.value,authority:'submitted_gpu_steps'},surfaceSelection:'scene-object-row; exact surface picking unavailable'};}
 return{bind,flush,advance,configure,regenerate,read,
  loadFormation(result){
   if(result.config.resolution!==n||result.config.width!==config.width||result.config.length!==config.length)throw Error('Formation grid does not match GPU terrain');
   if(!(result.state instanceof Float32Array)||result.state.length!==count*4||!result.state.every(Number.isFinite))throw Error('Complete finite formed state required');
   geoTilt.value=result.config.tilt;geoFold.value=result.config.fold;geoThickness.value=result.config.bedThickness;geoSeed.value=result.config.seed;
   formationProvenance={kind:'formed-landscape',version:result.version,recipe:{...result.config},preparationSteps:result.steps};
   formedAttribute.array.set(result.state);formedAttribute.needsUpdate=true;useFormed.value=1;initialized=false;steps=0;preparationSteps=0;seconds=0;generation++;alpha.value=1;if(renderer)flush(renderer);return read();
  },
  present(value){if(!Number.isFinite(value)||value<0||value>1)throw Error("Terrain interpolation must be in [0,1]");if(alpha.value!==value){alpha.value=value;pendingPresentation=true;}},
  // GPU resource access for same-device consumers. No state is copied to CPU.
  surface:()=>{if(!renderer)throw Error('Hill GPU not mounted');flush(renderer);return{device:renderer.backend.device,state:renderer.backend.get(displayAttribute).buffer,currentState:renderer.backend.get(stateAttributes[index]).buffer,previousState:renderer.backend.get(stateAttributes[1-index]).buffer,alpha:alpha.value,positions:renderer.backend.get(positions).buffer,normals:renderer.backend.get(normals).buffer,resolution:n,width:config.width,length:config.length,generation,steps};},
  // Explicit offline witness only. Never called by playback, controls or rendering.
  async snapshot({presentation=false}={}){if(!renderer||disposed)throw Error('Hill GPU not mounted');flush(renderer);const identity=read(),values=new Float32Array(await renderer.getArrayBufferAsync(stateAttributes[index]));if(values.length!==count*4||!values.every(Number.isFinite))throw Error('Invalid Hill GPU snapshot');const result={identity,values};if(presentation){result.display=new Float32Array(await renderer.getArrayBufferAsync(displayAttribute));result.positions=new Float32Array(await renderer.getArrayBufferAsync(positions));}return result;},
  dispose(){if(disposed)return;disposed=true;for(const node of nodes)node.dispose();if(renderer){renderer.backend.device.removeEventListener('uncapturederror',gpuError);for(const a of attributes)if(![positions,normals,colors].includes(a))renderer._attributes.delete(a);}}
 };
}
const initPosition=wgslFn('fn hill_vec4(x:f32,y:f32,z:f32)->vec4<f32>{return vec4<f32>(x,y,z,1.);}');
