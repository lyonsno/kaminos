import {readNeumipModel,writeNeumipModel} from './neumip-model.mjs';
export const STONE_HANDOFF_ARCHITECTURE='kaminos-stone-handoff-residual-v1';
export function createHandoffState(spec,resolution){
 const {routing:r,material:m,cheapResolution=64}=spec??{};
 if(!r||![r.width,r.depth,r.inner,r.collar].every(Number.isFinite)||r.width<=0||r.depth<=0||r.inner<0||r.collar<=0||r.inner+r.collar>=Math.min(r.width,r.depth)/4)throw Error('Invalid handoff routing');
 if(!m||!Array.isArray(m.color)||m.color.length!==3||!m.color.every(x=>Number.isFinite(x)&&x>=0)||!Number.isFinite(m.roughness)||m.roughness<0||m.roughness>1||!Number.isFinite(m.metalness)||m.metalness<0||m.metalness>1)throw Error('Invalid handoff material');
 if(!Number.isInteger(Math.log2(cheapResolution))||cheapResolution<2||cheapResolution>resolution)throw Error('Invalid cheap field resolution');
 const cheap=[];for(let n=cheapResolution;n>=2;n/=2)cheap.push({width:n,height:n,channels:3,data:new Float32Array(n*n*3)});
 return {routing:{...r},material:{...m,color:[...m.color]},cheap};
}
export function handoffWeight(uv,lod,resolution,r){
 const half=(x,p)=>{const d=Math.min(x,p/2),t=Math.max(0,Math.min(1,(d-r.inner)/r.collar));return d<=r.inner?0:d<r.inner+r.collar?r.collar*(t**3-.5*t**4):d-r.inner-r.collar/2;};
 const integral=(x,p)=>{const k=Math.floor(x/p),q=x-k*p,total=2*half(p/2,p);return k*total+(q<=p/2?half(q,p):total-half(p-q,p));};
 const averages=uv.map((u,i)=>{const width=i?r.depth:r.width,p=width/2,extent=2**lod/resolution*width,center=u*width;return (integral(center+extent/2,p)-integral(center-extent/2,p))/extent;});
 return Math.max(0,Math.min(1,1-averages[0]*averages[1]));
}
const f=x=>Number.isInteger(x)?x+'.0':String(x);
export function buildHandoffMath(handoff,resolution){
 const r=handoff.routing,m=handoff.material;
 const weight=`fn stoneHandoffWeight(uv:vec2<f32>,lod:f32)->f32 {
 let span=exp2(lod)/${f(resolution)};let cycle=fract(uv*2.0);let distance=min(cycle,vec2<f32>(1.0)-cycle)*vec2<f32>(${f(r.width/2)},${f(r.depth/2)});let halfWidth=span*vec2<f32>(${f(r.width)},${f(r.depth)})*0.5;if(all(distance>=vec2<f32>(${f(r.inner+r.collar)})+halfWidth)){return 0.0;}let x=stoneCheapAverage(uv.x*${f(r.width)},span*${f(r.width)},${f(r.width/2)});let y=stoneCheapAverage(uv.y*${f(r.depth)},span*${f(r.depth)},${f(r.depth/2)});return clamp(1.0-x*y,0.0,1.0);
}
fn stoneCheapHalf(x:f32)->f32 {if(x<=${f(r.inner)}){return 0.0;}if(x>=${f(r.inner+r.collar)}){return x-${f(r.inner+r.collar/2)};}let t=(x-${f(r.inner)})/${f(r.collar)};return ${f(r.collar)}*(t*t*t-0.5*t*t*t*t);}
fn stoneCheapIntegral(x:f32,period:f32)->f32 {let k=floor(x/period);let q=x-k*period;let total=2.0*stoneCheapHalf(period*0.5);if(q<=period*0.5){return k*total+stoneCheapHalf(q);}return (k+1.0)*total-stoneCheapHalf(period-q);}
fn stoneCheapAverage(center:f32,extent:f32,period:f32)->f32{return (stoneCheapIntegral(center+extent*0.5,period)-stoneCheapIntegral(center-extent*0.5,period))/extent;}`;
 // Same diffuse + GGX/Smith/Schlick law as the explicit SurfaceMaterialTeacher.
 const flat=`fn stoneFlatResponse(view:vec2<f32>,light:vec2<f32>)->vec3<f32>{
 let nv=sqrt(max(0.0,1.0-dot(view,view)));let nl=sqrt(max(0.0,1.0-dot(light,light)));if(nv<=0.0||nl<=0.0){return vec3<f32>(0.0);}
 let vl=dot(view,light)+nv*nl;let hn=sqrt(max(1e-8,2.0+2.0*vl));let nh=(nv+nl)/hn;let vh=(1.0+vl)/hn;
 let alpha=${f(Math.max(.02,m.roughness*m.roughness))};let a2=alpha*alpha;let denominator=nh*nh*(a2-1.0)+1.0;let D=a2/(3.141592653589793*denominator*denominator);
 let Gv=2.0*nv/max(nv+sqrt(a2+(1.0-a2)*nv*nv),1e-8);let Gl=2.0*nl/max(nl+sqrt(a2+(1.0-a2)*nl*nl),1e-8);
 let color=vec3<f32>(${m.color.map(f).join(',')});let F0=mix(vec3<f32>(0.04),color,${f(m.metalness)});let F=F0+(vec3<f32>(1.0)-F0)*pow(1.0-vh,5.0);
 return color*${f(1-m.metalness)}*(vec3<f32>(1.0)-F)/3.141592653589793+F*D*Gv*Gl/max(4.0*nl*nv,1e-8);
}`;
 return {weight,flat};
}
export function writeStoneHandoffModel(model){
 if(model.architecture!==STONE_HANDOFF_ARCHITECTURE||!model.handoff)throw Error('Paired handoff model required');
 const rich=writeNeumipModel(model),h=model.handoff;
 const header=new TextEncoder().encode(JSON.stringify({schema:'kaminos.stone-handoff-model.v1',richBytes:rich.length,routing:h.routing,material:h.material,cheapResolution:h.cheap[0].width}));
 const output=new Uint8Array(8+header.length+rich.length+h.cheap.reduce((n,t)=>n+t.data.length*4,0)),v=new DataView(output.buffer);output.set([75,83,72,49]);v.setUint32(4,header.length,true);output.set(header,8);let at=8+header.length;output.set(rich,at);at+=rich.length;
 for(const t of h.cheap)for(const x of t.data){if(!Number.isFinite(x))throw Error('Non-finite cheap field');v.setFloat32(at,x,true);at+=4;}readStoneHandoffModel(output);return output;
}
export function readStoneHandoffModel(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<8||bytes[0]!==75||bytes[1]!==83||bytes[2]!==72||bytes[3]!==49)throw Error('Invalid paired material schema');
 const length=v.getUint32(4,true);if(length>bytes.length-8)throw Error('Truncated paired header');const d=JSON.parse(new TextDecoder().decode(bytes.subarray(8,8+length)));let at=8+length;
 if(d.schema!=='kaminos.stone-handoff-model.v1'||!Number.isSafeInteger(d.richBytes)||d.richBytes<1||d.richBytes>bytes.length-at)throw Error('Invalid paired residual archive');
 const rich=readNeumipModel(bytes.subarray(at,at+d.richBytes));at+=d.richBytes;if(rich.architecture!==STONE_HANDOFF_ARCHITECTURE)throw Error('Wrong residual architecture');
 const validated=createHandoffState(d,rich.offset.width),remaining=validated.cheap.reduce((n,t)=>n+t.data.length*4,0);if(bytes.length-at!==remaining)throw Error('Paired cheap mip byte length mismatch');
 for(const t of validated.cheap)for(let i=0;i<t.data.length;i++){const x=v.getFloat32(at,true);at+=4;if(!Number.isFinite(x))throw Error('Non-finite cheap mip field');t.data[i]=x;}
 return {...rich,handoff:validated,byteLength:bytes.length};
}
export async function loadStoneHandoffModel(url,{sha256}={}){
 const response=await fetch(url);if(!response.ok)throw Error(`Paired model HTTP ${response.status}`);const bytes=await response.arrayBuffer();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(sha256&&sha256!==digest)throw Error('Paired model digest mismatch');return {...readStoneHandoffModel(bytes),source:{url:response.url,sha256:digest,bytes:bytes.byteLength}};
}
