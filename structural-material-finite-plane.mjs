export const FINITE_PLANE_ROUTE='kaminos.stone.finite-cell-plane.webgpu.v1';
const pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],dot=(a,b)=>a.reduce((sum,v,k)=>sum+v*b[k],0);
export function validateFinitePlane({normal,offset,friction,restitution}){
 if(!Array.isArray(normal)||normal.length!==3||!normal.every(Number.isFinite)||Math.abs(Math.hypot(...normal)-1)>1e-6)throw Error('Finite unit plane normal required');
 if(![offset,friction,restitution].every(v=>Number.isFinite(v)&&Number.isFinite(Math.fround(v)))||friction<0||restitution<0||restitution>1)throw Error('Finite GPU plane offset, nonnegative friction and restitution in [0,1] required');
}
export function packFiniteCellOwnership(binding){
 if(!binding?.fixedCellShell||!Number.isSafeInteger(binding.points)||binding.points<=0||!binding.entries?.length)throw Error('Complete fixed-cell ownership required');
 const bytes=new ArrayBuffer(binding.entries.length*80),u=new Uint32Array(bytes),f=new Float32Array(bytes),incident=Array.from({length:binding.points},()=>[]);
 binding.entries.forEach((e,i)=>{const base=i*20;if(!e.subset?.length||e.subset.length>4||new Set(e.subset).size!==e.subset.length||!e.subset.every(n=>Number.isSafeInteger(n)&&n>=0&&n<binding.points)||!e.subset.includes(e.anchor)||e.edgeIds?.length!==6||e.rest?.length!==3||!e.rest.every(Number.isFinite))throw Error('Complete local cell ownership required');
  u.set([...e.subset,...Array(4-e.subset.length).fill(e.anchor)],base);u.set(e.edgeIds.slice(0,4),base+4);u.set([e.edgeIds[4],e.edgeIds[5],0xffffffff,0xffffffff],base+8);u.set([e.subset.length,e.subset.indexOf(e.anchor),0,0],base+12);f.set([...e.rest,1],base+16);for(const node of e.subset)incident[node].push(i);
 });
 const offsets=[0];for(const entries of incident)offsets.push(offsets.at(-1)+entries.length);
 return{vertices:bytes,incidence:Uint32Array.from([...offsets,...incident.flat()])};
}
function reached(e,bonds){
 const ids=new Set([e.anchor]);let changed=true;while(changed){changed=false;for(let k=0;k<6;k++){const edge=e.edgeIds[k];if(edge===0xffffffff)continue;const [a,b]=pairs[k].map(j=>e.subset[j]);if(bonds[edge*4+2]===1&&(ids.has(a)||ids.has(b))&&(!ids.has(a)||!ids.has(b))){ids.add(a);ids.add(b);changed=true;}}}return ids;
}
export function projectFinitePlane(binding,bonds,state,plane){
 validateFinitePlane(plane);packFiniteCellOwnership(binding);
 if(!Array.isArray(bonds)||bonds.length%4||!['positions','velocities','pinned'].every(k=>state[k]?.length===binding.points)||!['positions','velocities'].every(k=>state[k].every(p=>p.length===3&&p.every(Number.isFinite)))||!state.pinned.every(p=>typeof p==='boolean'))throw Error('Complete finite-cell material state required');
 const bounds=Array(binding.points).fill(-Infinity);for(const e of binding.entries){const bound=plane.offset-dot(plane.normal,e.rest);for(const node of reached(e,bonds))bounds[node]=Math.max(bounds[node],bound);}
 const positions=state.positions.map(p=>[...p]),velocities=state.velocities.map(v=>[...v]);
 for(let i=0;i<binding.points;i++){
  if(state.pinned[i])continue;const delta=positions[i].map((v,k)=>v-binding.rest[i][k]),gap=dot(plane.normal,delta)-bounds[i];if(gap>1e-6)continue;
  if(gap<0)positions[i]=positions[i].map((v,k)=>v-plane.normal[k]*gap);
  const vn=dot(plane.normal,velocities[i]);if(vn>=0)continue;const bounce=vn<-.1?plane.restitution:0,tangent=velocities[i].map((v,k)=>v-plane.normal[k]*vn),speed=Math.hypot(...tangent),scale=speed>0?Math.max(0,1-plane.friction*(1+bounce)*-vn/speed):0;
  velocities[i]=tangent.map((v,k)=>v*scale-plane.normal[k]*bounce*vn);
 }
 return{positions,velocities,pinned:[...state.pinned]};
}
export const finiteCellWgsl=`
struct CellVertex{ids:vec4u,edges:vec4u,tail:vec4u,ownership:vec4u,rest:vec4f};
fn reachedCell(v:CellVertex)->u32{
 var reached=1u<<v.ownership.y;let pairs=array<vec2u,6>(vec2u(0,1),vec2u(0,2),vec2u(0,3),vec2u(1,2),vec2u(1,3),vec2u(2,3));
 for(var sweep=0u;sweep<4u;sweep++){for(var k=0u;k<6u;k++){var edge=v.tail[k%4u];if(k<4u){edge=v.edges[k];}if(edge==0xffffffffu){continue;}let pair=pairs[k];if(bonds[edge].z==1u&&((reached&(1u<<pair.x))!=0u||(reached&(1u<<pair.y))!=0u)){reached|=(1u<<pair.x)|(1u<<pair.y);}}}return reached;
}`;
