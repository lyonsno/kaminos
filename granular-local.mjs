import * as CANNON from './node_modules/cannon-es/dist/cannon-es.js';
import {createGranularPreparation,preparationCollisionHull} from './granular-preparation.mjs';

// Index centres; expand query by the largest radius, then test actual bounds.
// Geometry remains the very same convex hull in contacts and optical output.
export class GrainSpatialIndex{
 constructor(state,cellSize){
  if(!(cellSize>0&&Number.isFinite(cellSize)))throw Error('Invalid spatial cell size');
  this.state=state;this.size=cellSize;this.cells=new Map();this.large=new Set();this.positions=state.grains.map(g=>[...g.position]);this.keys=[];this.maxRadius=state.ingredients.reduce((r,g)=>g.radius<=cellSize?Math.max(r,g.radius):r,0);
  for(let id=0;id<state.grains.length;id++)this.insert(id);
 }
 key(p){return p.map(v=>Math.floor(v/this.size)).join(',');}
 insert(id){if(this.state.ingredients[id].radius>this.size){this.large.add(id);return;}const key=this.key(this.positions[id]);this.keys[id]=key;let cell=this.cells.get(key);if(!cell)this.cells.set(key,cell=new Set());cell.add(id);}
 update(id,position){const old=this.keys[id];this.positions[id]=[...position];if(this.large.has(id)||old===this.key(position))return;const cell=this.cells.get(old);cell.delete(id);if(!cell.size)this.cells.delete(old);this.insert(id);}
 query(bounds,{centres=false}={}){
  const r=centres?0:this.maxRadius,range=[0,1,2].map(k=>[Math.floor((bounds[k*2]-r)/this.size),Math.floor((bounds[k*2+1]+r)/this.size)]),found=[];
  // A very large prescribed parent can make cell enumeration worse than a
  // sparse occupied-cell walk. Both visit the complete query, without a cap.
  const volume=range.reduce((n,[a,b])=>n*(b-a+1),1),visit=cell=>{if(!cell)return;for(const id of cell){const p=this.positions[id],radius=centres?0:this.state.ingredients[id].radius;if(p.every((v,k)=>v+radius>=bounds[k*2]&&v-radius<=bounds[k*2+1]))found.push(id);}};
  if(volume>this.cells.size){for(const [key,cell]of this.cells){const xyz=key.split(',').map(Number);if(xyz.every((v,k)=>v>=range[k][0]&&v<=range[k][1]))visit(cell);}}
  else for(let x=range[0][0];x<=range[0][1];x++)for(let y=range[1][0];y<=range[1][1];y++)for(let z=range[2][0];z<=range[2][1];z++)visit(this.cells.get(`${x},${y},${z}`));
  visit(this.large);return found.sort((a,b)=>a-b);
 }
}
const boundsOf=(state,ids)=>{const b=[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];for(const id of ids){const p=state.grains[id].position,r=state.ingredients[id].radius;for(let k=0;k<3;k++){b[k*2]=Math.min(b[k*2],p[k]-r);b[k*2+1]=Math.max(b[k*2+1],p[k]+r);}}return b;};
export function relaxLocalPatch(state,index,{activeIds,commitIds=activeIds,seconds,padding}){
 if(!Array.isArray(activeIds)||!activeIds.length||new Set(activeIds).size!==activeIds.length||activeIds.some(id=>!state.grains[id]))throw Error('Invalid active identities');
 if(!Array.isArray(commitIds)||new Set(commitIds).size!==commitIds.length||commitIds.some(id=>!activeIds.includes(id)))throw Error('Invalid commit identities');
 if(!(seconds>0&&Number.isFinite(seconds)&&padding>0&&Number.isFinite(padding)))throw Error('Invalid local duration or padding');
 const origin=boundsOf(state,activeIds);let attempts=0,totalBodyBuilds=0,totalEvaluatedSteps=0;
 for(;;){
  attempts++;const bounds=origin.map((v,k)=>v+(k%2?padding:-padding)),ids=[...new Set([...activeIds,...index.query(bounds)])].sort((a,b)=>a-b),localIds=new Map(ids.map((id,i)=>[id,i])),activeLocal=activeIds.map(id=>localIds.get(id));totalBodyBuilds+=ids.length;
  const local={...state,recipe:{...state.recipe,count:ids.length},ingredients:ids.map((id,i)=>({...state.ingredients[id],id:i})),grains:ids.map((id,i)=>({...state.grains[id],id:i})),history:[],phase:null};
  const model=createGranularPreparation(null,local,{activeIds:activeLocal});let escaped=false,rows;
  try{
   let status=model.start('settle',{seconds}),elapsed=0;const h=seconds/Math.ceil(seconds/state.recipe.dt);
   while(status.phase){const dt=Math.min(h,seconds-elapsed);status=model.advance(dt,{summary:false});elapsed+=dt;totalEvaluatedSteps+=activeIds.length;
    const current=model.readGrains(activeLocal);
    if(ids.length<state.grains.length&&current.some((row,i)=>row.position.some((v,k)=>v-state.ingredients[activeIds[i]].radius<bounds[k*2]||v+state.ingredients[activeIds[i]].radius>bounds[k*2+1]))){escaped=true;break;}
   }
   if(!escaped)rows=model.readGrains(commitIds.map(id=>localIds.get(id))).map((row,i)=>({...row,id:commitIds[i]}));
  }finally{model.dispose();}
  // A step that escaped its collision context is discarded, not clipped.
  // Retry from the unchanged canonical input with a wider retained context.
  if(escaped){padding*=2;continue;}
  return {rows,bodyCount:ids.length,activeCount:activeIds.length,commitCount:commitIds.length,attempts,totalBodyBuilds,totalEvaluatedSteps,bounds,contextIds:ids};
 }
}

export function localPackingMetrics(state,index,anchorIds=[]){
 const anchors=new Set(anchorIds),shapes=new Map(),shape=id=>{let s=shapes.get(id);if(!s){s=preparationCollisionHull(state.ingredients[id]);shapes.set(id,s);}return s;},positions=state.grains.map(g=>new CANNON.Vec3(...g.position)),quaternions=state.grains.map(g=>new CANNON.Quaternion(...g.quaternion));let contacts=0,maxPenetration=0,maxFloorPenetration=0,maxLidPenetration=0,candidatePairs=0;
 for(let i=0;i<state.grains.length;i++){
  const p=state.grains[i].position,r=state.ingredients[i].radius;
  if(!anchors.has(i))for(const v of shape(i).vertices){const q=quaternions[i].vmult(v).vadd(positions[i]);maxFloorPenetration=Math.max(maxFloorPenetration,-q.y);maxLidPenetration=Math.max(maxLidPenetration,q.y-state.lidHeight);}
  for(const j of index.query(p.flatMap(v=>[v-r,v+r]))){if(j<=i||(anchors.has(i)&&anchors.has(j)))continue;candidatePairs++;if(positions[i].distanceTo(positions[j])>=r+state.ingredients[j].radius)continue;const axis=new CANNON.Vec3();if(shape(i).findSeparatingAxis(shape(j),positions[i],quaternions[i],positions[j],quaternions[j],axis)){const depth=shape(i).testSepAxis(axis,shape(j),positions[i],quaternions[i],positions[j],quaternions[j]);if(depth>0){contacts++;maxPenetration=Math.max(maxPenetration,depth);}}}
 }
 return {grains:state.grains.length,mass:state.ingredients.reduce((n,g)=>n+g.mass,0),contacts,maxPenetration,maxFloorPenetration,maxLidPenetration,candidatePairs};
}
