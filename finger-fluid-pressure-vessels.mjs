// Finite gravity/head witness. No emitter, imposed jet profile or recirculation.
export const PRESSURE_GATE_STEP=90;
export const PRESSURE_STATIONS=Object.freeze([
 {name:'wide outlet',x:-2.05,width:.30,exitWidth:.30},
 {name:'narrow spout',x:0,width:.135,exitWidth:.135},
 {name:'converging funnel',x:2.05,width:.30,exitWidth:.15},
]);
const axes=[[1,0,0],[0,1,0],[0,0,1]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const boxes=[];
function add(station,center,half,basis=axes,gate=false){boxes.push({station,center,half,axes:basis,gate})}
for(const [station,s] of PRESSURE_STATIONS.entries()){
 const x=s.x,w=s.width,y=-.30,floor=-.8,top=.9,z=-.85;
 add(station,[x,-.86,-1.675],[.82,.06,.885]);
 add(station,[x,.05,-2.5],[.88,.85,.06]);
 for(const side of [-1,1])add(station,[x+side*.82,.05,-1.675],[.06,.85,.885]);
 for(const side of [-1,1])add(station,[x+side*(.82+w)/2,.05,z],[(.82-w)/2,.85,.06]);
 add(station,[x,(floor+y-w)/2,z],[w,(y-w-floor)/2,.06]);
 add(station,[x,(top+y+w)/2,z],[w,(top-y-w)/2,.06]);
 add(station,[x,y,z],[w,w,.06],axes,true);
 const end=s.exitWidth,startZ=-.85,endZ=-.10,length=endZ-startZ;
 for(const side of [-1,1]){
  const slope=side*(end-w)/length,n=Math.hypot(slope,1),t=[slope/n,0,1/n],normal=[1/n,0,-slope/n];
  add(station,[x+side*(w+end)/2+side*.06,y,(startZ+endZ)/2],[.06,w+.06,length*n/2],[normal,[0,1,0],t]);
  const v=[0,slope/n,1/n],up=[0,1/n,-slope/n];
  add(station,[x,y+side*(w+end)/2+side*.06,(startZ+endZ)/2],[w+.12,.06,length*n/2],[[1,0,0],up,v]);
 }
}
export const PRESSURE_BOXES=Object.freeze(boxes);
export function pressureSolidFrame(p,closed){
 let result={normal:[0,1,0],distance:p[1]+.95};
 for(const b of boxes){
  if(b.gate&&!closed)continue;
  const rel=p.map((v,i)=>v-b.center[i]),local=b.axes.map(a=>dot(rel,a));
  const q=local.map((v,i)=>Math.abs(v)-b.half[i]),out=q.map(v=>Math.max(v,0)),length=Math.hypot(...out);
  const d=length+Math.min(Math.max(...q),0);
  if(d>=result.distance)continue;
  let n;
  if(length>1e-12)n=out.map((v,i)=>v/length*(local[i]>=0?1:-1));
  else{const axis=q.indexOf(Math.max(...q));n=[0,0,0];n[axis]=local[axis]>=0?1:-1}
  result={distance:d,normal:[0,1,2].map(i=>n.reduce((sum,v,a)=>sum+v*b.axes[a][i],0))};
 }
 return result;
}
export function pressureResolve(position,radius,closed){
 let p=[...position];
 for(let i=0;i<3;i++){const f=pressureSolidFrame(p,closed);if(f.distance>=radius)break;p=p.map((v,a)=>v+f.normal[a]*(radius-f.distance+1e-6))}
 return p;
}
export function createPressureParticles(count,reference=count){
 const data=new Float32Array(count*16),counts=[0,0,0],referenceCounts=[0,0,0];
 for(let i=0;i<count;i++)counts[i%3]++;
 for(let i=0;i<reference;i++)referenceCounts[i%3]++;
 for(let i=0;i<count;i++){
  const station=i%3,s=PRESSURE_STATIONS[station],r=Math.floor(Math.floor(i/3)*referenceCounts[station]/counts[station]);
  const x=s.x+(r%24-11.5)*.055,z=-1.65+(Math.floor(r/24)%24-11.5)*.055,y=-.8+.055*(1+Math.floor(r/576));
  data.set([x,y,z,1,x,y,z,0,0,0,0,[.22,.52,.82][station],0,0,0,0],i*16);
 }
 return data;
}
const f=n=>Number.isInteger(n)?n+'.0':String(n),vec=v=>'vec3<f32>('+v.map(f).join(',')+')';
export const PRESSURE_COLLISION_WGSL=/*wgsl*/`
const pressurePlaygroundEnabled: bool = false;
struct PressureBox { center:vec3<f32>, extent:vec3<f32>, x:vec3<f32>, y:vec3<f32>, z:vec3<f32>, station:u32, gate:u32 }
const pressureBoxes = array<PressureBox,${boxes.length}>(
 ${boxes.map(b=>`PressureBox(${vec(b.center)},${vec(b.half)},${b.axes.map(vec).join(',')},${b.station}u,${b.gate?1:0}u)`).join(',\n')}
);
fn pressureSolidFrame(p:vec3<f32>,closed:bool)->vec4<f32>{
 var result=vec4<f32>(0.0,1.0,0.0,p.y+0.95);
 let station=u32(clamp(round((p.x+2.05)/2.05),0.0,2.0));
 for(var i=station*13u;i<(station+1u)*13u;i++){
  let b=pressureBoxes[i];if(b.gate!=0u&&!closed){continue;}
  let rel=p-b.center;let local=vec3<f32>(dot(rel,b.x),dot(rel,b.y),dot(rel,b.z));
  let q=abs(local)-b.extent;let outside=max(q,vec3<f32>(0.0));let len=length(outside);
  let d=len+min(max(q.x,max(q.y,q.z)),0.0);if(d>=result.w){continue;}
  var n=vec3<f32>(0.0);
  let signs=select(vec3<f32>(-1.0),vec3<f32>(1.0),local>=vec3<f32>(0.0));
  if(len>0.000001){n=outside/len*signs;}else{
   if(q.x>=q.y&&q.x>=q.z){n.x=signs.x;}else if(q.y>=q.z){n.y=signs.y;}else{n.z=signs.z;}
  }
  result=vec4<f32>(b.x*n.x+b.y*n.y+b.z*n.z,d);
 }
 return result;
}
fn pressureResolve(initial:vec3<f32>,radius:f32,closed:bool)->vec3<f32>{
 var p=initial;for(var i=0u;i<3u;i++){let f=pressureSolidFrame(p,closed);if(f.w>=radius){break;}p+=f.xyz*(radius-f.w+0.000001);}return p;
}
`;
export const PRESSURE_SOLID_VERTEX_COUNT=boxes.length*36;
export const PRESSURE_RENDER_WGSL=/*wgsl*/`
struct PressureVertex {position:vec3<f32>,normal:vec3<f32>}
fn pressureSolidVertex(index:u32,closed:bool)->PressureVertex {
 let b=pressureBoxes[index/36u];let face=(index%36u)/6u;
 let corners=array<vec2<f32>,6>(vec2<f32>(-1.0,-1.0),vec2<f32>(1.0,-1.0),vec2<f32>(-1.0,1.0),vec2<f32>(-1.0,1.0),vec2<f32>(1.0,-1.0),vec2<f32>(1.0,1.0));
 let uv=corners[index%6u];var local=vec3<f32>(0.0);var n=vec3<f32>(0.0);let side=select(-1.0,1.0,face%2u==0u);
 if(face<2u){local=vec3<f32>(side*b.extent.x,uv.x*b.extent.y,uv.y*b.extent.z);n.x=side;}
 else if(face<4u){local=vec3<f32>(uv.x*b.extent.x,side*b.extent.y,uv.y*b.extent.z);n.y=side;}
 else{local=vec3<f32>(uv.x*b.extent.x,uv.y*b.extent.y,side*b.extent.z);n.z=side;}
 var position=b.center+b.x*local.x+b.y*local.y+b.z*local.z;
 if(b.gate!=0u&&!closed){position=vec3<f32>(1000.0);}
 return PressureVertex(position,b.x*n.x+b.y*n.y+b.z*n.z);
}
`;
