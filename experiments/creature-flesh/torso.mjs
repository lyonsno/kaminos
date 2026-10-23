import {sub,dot,cross} from './elastic.mjs';
const unit=p=>{const n=Math.hypot(...p);if(!(n>1e-10))throw Error('Degenerate torso frame');return p.map(v=>v/n);};
const perms=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// Explicit alternative to nearest-surface attachment for the internal volume.
// A whole section shares its spine blend; skin weights and embedding stay intact.
export function torsoNodeWeights(prepared,channels){
 const ids=['pelvis','spine-lumbar','spine-chest'].map(n=>channels.indexOf(n));
 if(ids.some(i=>i<0))throw Error('Complete torso channel family required');
 const {sections,crossSection}=prepared.construction;
 if(!Number.isSafeInteger(sections)||sections<3||!Number.isSafeInteger(crossSection)||crossSection<3||crossSection%2!==1||prepared.positions.length!==sections*crossSection**2)throw Error('Matching odd cross-section lattice required');
 const out=new Float32Array(prepared.positions.length*channels.length);
 for(let i=0;i<prepared.positions.length;i++){
  const t=Math.floor(i/crossSection**2)/(sections-1)*2,segment=Math.min(1,Math.floor(t)),f=t-segment;
  out[i*channels.length+ids[segment]]=1-f;out[i*channels.length+ids[segment+1]]=f;
 }
 return out;
}

// A provisional mechanical proxy, not inferred anatomy or repaired source skin.
// Cross-sections use every vertex in the accepted torso-dominant partition;
// the detailed surface remains untouched, including all disconnected geometry.
export function prepareTorso({manifest,rest,weights},{crossSection=5,sections=7,exteriorFalloff=.3}={}){
 const channels=manifest?.channels,n=rest?.length/3,C=channels?.length;
 if(!Number.isInteger(n)||!C||weights?.length!==n*C||!rest.every(Number.isFinite)||!weights.every(v=>Number.isFinite(v)&&v>=0))throw Error('Complete finite skin and influences required');
 if(!Number.isSafeInteger(crossSection)||crossSection<3||crossSection%2!==1||!Number.isSafeInteger(sections)||sections<3||!(Number.isFinite(exteriorFalloff)&&exteriorFalloff>0))throw Error('Odd cross-section resolution, sections and exterior falloff required');
 const bone=name=>{const b=manifest.bones.find(b=>b.name===name);if(!b)throw Error('This torso proxy requires the given pelvis/lumbar/chest family');return b.restMatrix.slice(0,3).map(r=>r[3]);};
 const origin=bone('pelvis'),end=bone('spine-chest'),axis=unit(sub(end,origin)),right=unit(cross([0,1,0],axis)),up=unit(cross(axis,right)),length=Math.hypot(...sub(end,origin));
 const torsoChannels=channels.flatMap((name,i)=>['pelvis','spine-lumbar','spine-chest'].includes(name)?[i]:[]);
 if(torsoChannels.length!==3)throw Error('Complete torso channel family required');
 const local=Array.from({length:n},(_,i)=>{const q=sub(Array.from(rest.subarray(i*3,i*3+3)),origin);return[dot(q,right),dot(q,up),dot(q,axis)/length];});
 const profile=Array.from({length:sections},()=>({min:[Infinity,Infinity],max:[-Infinity,-Infinity],vertices:0}));
 let dominantVertices=0;
 for(let i=0;i<n;i++){
  const total=Array.from(weights.subarray(i*C,(i+1)*C)).reduce((a,b)=>a+b,0);if(Math.abs(total-1)>1e-5)throw Error('Incomplete source influence partition');
  let dominant=0;for(let c=1;c<C;c++)if(weights[i*C+c]>weights[i*C+dominant])dominant=c;
  const p=local[i];if(p[2]<0||p[2]>1||!torsoChannels.includes(dominant))continue;
  const row=Math.round(p[2]*(sections-1)),slice=profile[row];slice.vertices++;dominantVertices++;
  for(let a=0;a<2;a++){slice.min[a]=Math.min(slice.min[a],p[a]);slice.max[a]=Math.max(slice.max[a],p[a]);}
 }
 for(const p of profile){if(!p.vertices||p.max.some((v,a)=>!(v-p.min[a]>1e-8)))throw Error('Torso section lacks source surface support');p.center=p.min.map((v,a)=>(v+p.max[a])/2);p.radius=p.min.map((v,a)=>(p.max[a]-v)/2);}
 const id=(i,j,k)=>(k*crossSection+j)*crossSection+i,positions=[],pinned=[];
 for(let k=0;k<sections;k++)for(let j=0;j<crossSection;j++)for(let i=0;i<crossSection;i++){
  const u=2*i/(crossSection-1)-1,v=2*j/(crossSection-1)-1,x=profile[k].center[0]+profile[k].radius[0]*u*Math.sqrt(1-v*v/2),y=profile[k].center[1]+profile[k].radius[1]*v*Math.sqrt(1-u*u/2);
  positions.push(origin.map((o,a)=>o+axis[a]*length*k/(sections-1)+right[a]*x+up[a]*y));
  pinned.push(k===0||k===sections-1||(i===(crossSection-1)/2&&j===(crossSection-1)/2));
 }
 const tetrahedra=[];
 for(let k=0;k<sections-1;k++)for(let j=0;j<crossSection-1;j++)for(let i=0;i<crossSection-1;i++)for(const perm of perms){const q=[i,j,k],t=[id(...q)];for(const a of perm){q[a]++;t.push(id(...q));}tetrahedra.push(t);}
 const nodeWeights=new Float32Array(positions.length*C),nearest=[];
 for(let node=0;node<positions.length;node++){
  let best=-1,distance=Infinity;const p=positions[node];
  for(let i=0;i<n;i++){const d=(rest[i*3]-p[0])**2+(rest[i*3+1]-p[1])**2+(rest[i*3+2]-p[2])**2;if(d<distance){best=i;distance=d;}}
  nodeWeights.set(weights.subarray(best*C,(best+1)*C),node*C);nearest.push({vertex:best,distance:Math.sqrt(distance)});
 }
 const bindings=new Uint32Array(n*4),bindingWeights=new Float32Array(n*4);let influencedVertices=0;
 for(let i=0;i<n;i++){
  const p=local[i],z=p[2]*(sections-1);if(z<0||z>sections-1)continue;
  const k=Math.min(sections-2,Math.floor(z)),f=z-k;
  const center=[0,1].map(a=>profile[k].center[a]*(1-f)+profile[k+1].center[a]*f),radius=[0,1].map(a=>profile[k].radius[a]*(1-f)+profile[k+1].radius[a]*f);
  let x=(p[0]-center[0])/radius[0],y=(p[1]-center[1])/radius[1],r=Math.hypot(x,y);
  const share=torsoChannels.reduce((sum,c)=>sum+weights[i*C+c],0),strength=share*clamp(1-(r-1)/exteriorFalloff,0,1);if(strength===0)continue;
  if(r>1){x/=r;y/=r;}
  const inv=(a,b)=>(Math.sqrt(Math.max(0,2+a*a-b*b+2*Math.SQRT2*a))-Math.sqrt(Math.max(0,2+a*a-b*b-2*Math.SQRT2*a)))/2;
  const grid=[clamp((inv(x,y)+1)/2*(crossSection-1),0,crossSection-1),clamp((inv(y,x)+1)/2*(crossSection-1),0,crossSection-1),z],base=grid.map((v,a)=>Math.min((a===2?sections:crossSection)-2,Math.floor(v))),frac=grid.map((v,a)=>v-base[a]),order=[0,1,2].sort((a,b)=>frac[b]-frac[a]||a-b),q=[...base],ids=[id(...q)];for(const a of order){q[a]++;ids.push(id(...q));}
  const sorted=order.map(a=>frac[a]),w=[1-sorted[0],sorted[0]-sorted[1],sorted[1]-sorted[2],sorted[2]];bindings.set(ids,i*4);bindingWeights.set(w.map(v=>v*strength),i*4);influencedVertices++;
 }
 return{schema:'kaminos.creature-flesh.torso-proxy.v0',positions,tetrahedra,pinned,nodeWeights:Array.from(nodeWeights),bindings:Array.from(bindings),bindingWeights:Array.from(bindingWeights),source:{vertices:n,channels:C},construction:{crossSection,sections,exteriorFalloff,origin,end,axis,right,up,length,profile,dominantVertices,influencedVertices,nearest,claim:'Torso partition envelope and parametric displacement embedding; no anatomical, muscle or watertight-source admission'}};
}

export function addFleshOffsets(base,prepared,offsets){
 if(base.length!==prepared.source.vertices*3||offsets.length!==prepared.positions.length)throw Error('Matching dense skin and physical volume required');
 const out=Float32Array.from(base);
 for(let i=0;i<prepared.source.vertices;i++){
  const start=prepared.bindingOffsets?.[i]??i*4,end=prepared.bindingOffsets?.[i+1]??start+4;
  for(let j=start;j<end;j++){const w=prepared.bindingWeights[j];if(!w)continue;const p=offsets[prepared.bindings[j]];for(let a=0;a<3;a++)out[i*3+a]+=w*p[a];}
 }
 return out;
}
