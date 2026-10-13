export const STONE_GRAIN_ROUTE='kaminos.stone.connected-grains.v1';

export function buildStoneGrains({positions,bonds,scale,interiorStrength=8}){
 if(!positions?.length||!positions.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||!Array.isArray(bonds)||!bonds.every(e=>Array.isArray(e)&&e.length===2&&e.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length)&&e[0]!==e[1])||!Number.isFinite(scale)||scale<=0||!Number.isFinite(Math.fround(interiorStrength))||interiorStrength<1)throw Error('Finite connected grain geometry, scale and strength required');
 const neighbors=positions.map(()=>[]);
 for(const [a,b] of bonds){const distance=Math.hypot(...positions[a].map((v,k)=>v-positions[b][k]));neighbors[a].push([b,distance]);neighbors[b].push([a,distance]);}
 const rank=i=>{let h=Math.imul(i+1,0x9e3779b1);h^=h>>>16;h=Math.imul(h,0x85ebca6b);return(h^(h>>>13))>>>0;};
 const seeds=positions.map((_,i)=>i).sort((a,b)=>rank(a)-rank(b)||a-b),nodeGrains=Array(positions.length).fill(-1),groups=[];
 for(const seed of seeds){
  if(nodeGrains[seed]!==-1)continue;const grain=groups.length,group=[],front=[[seed,0]],distance=new Map([[seed,0]]);
  while(front.length){front.sort((a,b)=>b[1]-a[1]||b[0]-a[0]);const [node,d]=front.pop();if(nodeGrains[node]!==-1||d!==distance.get(node))continue;nodeGrains[node]=grain;group.push(node);
   for(const [next,length] of neighbors[node]){const nd=d+length;if(nodeGrains[next]===-1&&nd<=scale&&nd<(distance.get(next)??Infinity)){distance.set(next,nd);front.push([next,nd]);}}
  }
  groups.push(group.sort((a,b)=>a-b));
 }
 return{route:STONE_GRAIN_ROUTE,scale,interiorStrength,nodeGrains,groups,bondStrengths:bonds.map(([a,b])=>nodeGrains[a]===nodeGrains[b]?interiorStrength:1),claim:'Provisional geodesic stone grains; finite stronger interiors remain breakable, not calibrated material'};
}

export function packStoneGrainStrengths(arrays,grains){
 if(arrays.bonds.length!==grains.bondStrengths.length*4)throw Error('Grain strength must match every material bond');
 const values=new Float32Array(1),bits=new Uint32Array(values.buffer);
 grains.bondStrengths.forEach((strength,i)=>{values[0]=strength;arrays.bonds[i*4+3]=bits[0];});
 return arrays;
}
