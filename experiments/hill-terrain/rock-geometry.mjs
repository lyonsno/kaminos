// Initial authored rock construction. This is geometry, not a fracture simulation.
// A plane [nx,ny,nz,d] bounds the solid by dot(n,p) <= d.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const norm=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
const EPS=1e-7;

export function buildConvexRock(input){
 if(!Array.isArray(input)||input.length<4)throw Error('A bounded rock needs at least four planes');
 const planes=input.map(p=>{
  if(!Array.isArray(p)||p.length!==4||!p.every(Number.isFinite)||Math.hypot(...p.slice(0,3))<EPS)throw Error('Invalid rock plane');
  const l=Math.hypot(...p.slice(0,3));return p.map(v=>v/l);
 });
 const vertices=[];
 for(let i=0;i<planes.length;i++)for(let j=i+1;j<planes.length;j++)for(let k=j+1;k<planes.length;k++){
  const a=planes[i].slice(0,3),b=planes[j].slice(0,3),c=planes[k].slice(0,3),bc=cross(b,c),ca=cross(c,a),ab=cross(a,b),det=dot(a,bc);
  if(Math.abs(det)<EPS)continue;
  const p=a.map((_,q)=>(planes[i][3]*bc[q]+planes[j][3]*ca[q]+planes[k][3]*ab[q])/det);
  if(planes.every(pl=>dot(pl.slice(0,3),p)<=pl[3]+EPS)&&!vertices.some(v=>Math.hypot(...sub(v,p))<EPS*4))vertices.push(p);
 }
 const faces=[],positions=[],normals=[],edges=new Map();
 for(let i=0;i<planes.length;i++){
  const pl=planes[i],n=pl.slice(0,3),face=vertices.filter(p=>Math.abs(dot(n,p)-pl[3])<EPS*4);
  if(face.length<3)continue;
  const center=[0,1,2].map(q=>face.reduce((s,p)=>s+p[q],0)/face.length);
  const u=norm(cross(Math.abs(n[1])<.9?[0,1,0]:[1,0,0],n)),v=cross(n,u);
  face.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
  faces.push({plane:i,normal:n,vertices:face});
  for(let j=0;j<face.length;j++){
   const key=[vertices.indexOf(face[j]),vertices.indexOf(face[(j+1)%face.length])].sort((a,b)=>a-b).join(':');edges.set(key,(edges.get(key)||0)+1);
  }
  for(let j=1;j+1<face.length;j++)for(const p of [face[0],face[j],face[j+1]]){positions.push(...p);normals.push(...n);}
 }
 if(vertices.length<4||faces.length<4||[...edges.values()].some(n=>n!==2))throw Error('Rock planes define an empty or unbounded solid');
 return{planes,faces,positions,normals};
}

export function raycastRock(solids,origin,direction){
 if(![origin,direction].every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite))||Math.hypot(...direction)<EPS)throw Error('Invalid rock ray');
 const d=norm(direction),intervals=[];
 for(let block=0;block<solids.length;block++){
  let enter=-Infinity,exit=Infinity,entryFace=-1,exitFace=-1,miss=false;
  const solid=solids[block];
  for(let i=0;i<solid.planes.length;i++){
   const p=solid.planes[i],n=p.slice(0,3),den=dot(n,d),offset=p[3]-dot(n,origin);
   if(Math.abs(den)<EPS){if(offset<0){miss=true;break;}continue;}
   const t=offset/den;
   if(den<0&&t>enter){enter=t;entryFace=i;}if(den>0&&t<exit){exit=t;exitFace=i;}
  }
  if(miss||enter>exit+EPS||exit<0)continue;
  intervals.push({enter,exit,block,entryFace,exitFace});
 }
 const inside=intervals.filter(i=>i.enter<0);let chosen,t,face;
 if(inside.length){
  chosen=inside.reduce((a,b)=>a.exit>b.exit?a:b);t=chosen.exit;
  for(let pass=0;pass<intervals.length;pass++){
   const next=intervals.find(i=>i.enter<=t+EPS&&i.exit>t+EPS);if(!next)break;chosen=next;t=next.exit;
  }
  face=chosen.exitFace;
 }else{
  if(!intervals.length)return null;chosen=intervals.reduce((a,b)=>a.enter<b.enter?a:b);t=chosen.enter;face=chosen.entryFace;
 }
 return{distance:t,block:chosen.block,face,normal:solids[chosen.block].planes[face].slice(0,3),position:origin.map((v,i)=>v+t*d[i])};
}

export function createRockOutcrop({origin=[-.05,.43,1.75],scale=1,gap=.018,wear=.028}={}){
 if(!Array.isArray(origin)||origin.length!==3||!origin.every(Number.isFinite))throw Error('Invalid outcrop origin');
 if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(gap)||gap<0||gap>.12||!Number.isFinite(wear)||wear<0||wear>.10)throw Error('Invalid outcrop dimensions');
 // Three beds, unequal blocks, two staggered joint traces. These explicit
 // authored values define the comparison; they are not a general geology law.
 const levels=[0,.28,.53,.87],cuts=[-.85,-.28,.32,.85],solids=[];
 for(let bed=0;bed<3;bed++)for(let block=0;block<3;block++){
  const y0=bed?levels[bed]-.035:-.40,y1=levels[bed+1],shift=[0,.055,-.025][bed];
  const x0=cuts[block]+shift+(block?gap*.5:0),x1=cuts[block+1]+shift-(block<2?gap*.5:0);
  const front=[.46,.34,.43][block]+[.10,.005,.028][bed];
  const lean=[.045,-.025,.065][block],jointLean=[.09,-.055,.04][bed];
  const local=[
   [1,jointLean,.13,x1],[-1,-jointLean,-.13,-x0],
   [-.075,1,.035,y1],[.075,-1,-.035,-y0],
   [lean,.035,1,front],[0,0,-1,.70],
   // Broken front corners and bed edges are explicit facets, not normal noise.
   [1,0,1,x1+front-wear*(block===1?.55:1.7)],
   [-1,0,1,-x0+front-wear*(block===2?1.8:.7)],
   [-.075,1,1,y1+front-wear*(1.0+.35*block)],
   [.075,-1,1,-y0+front-wear*.65]
  ];
  // One terminating front recess. It stops at the lower bed instead of
  // creating a periodic channel through every bed and into surrounding soil.
  if(bed===1&&block===1)local.push([.45,.15,1,front-.055]);
  // A few unequal fracture facets, with different terminations per block.
  // These clip a finite face region; they do not emboss a repeating pattern.
  local.push([block===0?-.55:.38,.22,1,front+.22*y1-.028-.018*block]);
  if(bed===2){
   local.push([block===1?-.24:.18,1,.20,y1+.20*front-.045*(block+1)]);
   local.push([block===0?-.65:.65,.55,.8,(block===0?-x0:x1)*.65+y1*.55+front*.8-wear*2.8]);
  }
  const planes=local.map(([nx,ny,nz,d])=>[nx,ny,nz,d*scale+nx*origin[0]+ny*origin[1]+nz*origin[2]]);
  solids.push({...buildConvexRock(planes),id:`bed-${bed}-block-${block}`,bed});
 }
 return{kind:'plane-defined-rock-v1',origin:[...origin],scale,gap,wear,solids};
}

export function packRockPlanes(solids){
 const planes=[],blocks=[];
 for(const s of solids){blocks.push(planes.length/4,s.planes.length,0,0);for(const p of s.planes)planes.push(...p);}
 return{planes:new Float32Array(planes),blocks:new Uint32Array(blocks)};
}

// Production query source for contact adapters. It represents arbitrary rays,
// including underside contact; no projection onto a heightfield is involved.
export const ROCK_RAY_WGSL=`
struct RockInterval { entry:vec4<f32>, exit:vec4<f32> }
fn rock_interval(origin:vec3<f32>,dir:vec3<f32>,block:vec4<u32>,planes:ptr<storage,array<vec4<f32>>,read>)->RockInterval{
 var enter=-1e30;var exit=1e30;var en=vec3<f32>(0.);var ex=vec3<f32>(0.);
 for(var j=0u;j<block.y;j++){
  let p=(*planes)[block.x+j];let den=dot(p.xyz,dir);let off=p.w-dot(p.xyz,origin);
  if(abs(den)<1e-7){if(off<0.){return RockInterval(vec4<f32>(0.,0.,0.,1.),vec4<f32>(0.,0.,0.,-1.));}continue;}
  let t=off/den;
  if(den<0.&&t>enter){enter=t;en=p.xyz;}if(den>0.&&t<exit){exit=t;ex=p.xyz;}
 }
 return RockInterval(vec4<f32>(en,enter),vec4<f32>(ex,exit));
}
fn rock_ray(origin:vec3<f32>,direction:vec3<f32>,planes:ptr<storage,array<vec4<f32>>,read>,blocks:ptr<storage,array<vec4<u32>>,read>)->vec4<f32>{
 let dir=normalize(direction);var nearest=vec4<f32>(0.,0.,0.,1e30);var outer=vec4<f32>(0.,0.,0.,-1.);
 for(var b=0u;b<arrayLength(blocks);b++){
  let i=rock_interval(origin,dir,(*blocks)[b],planes);
  if(i.entry.w>i.exit.w+1e-7||i.exit.w<0.){continue;}
  if(i.entry.w<0.){if(i.exit.w>outer.w){outer=i.exit;}}
  else if(i.entry.w<nearest.w){nearest=i.entry;}
 }
 if(outer.w>=0.){
  for(var pass=0u;pass<arrayLength(blocks);pass++){
   let previous=outer.w;
   for(var b=0u;b<arrayLength(blocks);b++){
    let i=rock_interval(origin,dir,(*blocks)[b],planes);
    if(i.entry.w<=i.exit.w+1e-7&&i.entry.w<=outer.w+1e-7&&i.exit.w>outer.w){outer=i.exit;}
   }
   if(outer.w==previous){break;}
  }
  return outer;
 }
 if(nearest.w==1e30){return vec4<f32>(0.,0.,0.,-1.);}return nearest;
}`;
