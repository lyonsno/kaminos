// Setup/checkpoint work only. Live evolution and surface compaction stay on GPU.
export function patchLayout({cellSize,bounds,tileSize}){
 if(!Number.isFinite(cellSize)||cellSize<=0)throw Error('Invalid cell width');
 if(!bounds||![bounds.min,bounds.max].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||bounds.max.some((v,i)=>v<=bounds.min[i]))throw Error('Invalid patch bounds');
 const dims=bounds.max.map((v,i)=>Math.ceil((v-bounds.min[i])/cellSize-1e-10));
 const count=dims.reduce((a,b)=>a*b,1);if(!Number.isSafeInteger(count))throw Error('Patch capacity is not representable');
 const p={cellSize,bounds:structuredClone(bounds),dims,count,origin:[...bounds.min]};
 if(tileSize!==undefined){
  if(!Number.isSafeInteger(tileSize)||tileSize<1)throw Error('Invalid tile width');
  const td=dims.map(n=>Math.ceil(n/tileSize)),tiles=td.reduce((a,b)=>a*b,1),cells=tileSize**3;
  if(!Number.isSafeInteger(tiles*cells*6))throw Error('Tile capacity is not representable');
  p.tiles={width:tileSize,dims:td,count:tiles,cellsPerTile:cells,groupsPerTile:Math.ceil(cells/64),phaseHalo:Math.ceil(6/tileSize)};
 }
 return p;
}
export function seedPatch(p,solid,{volume,radius,center},previous=new Float32Array(p.count)){
 if(!Number.isFinite(volume)||volume<=0||!Number.isFinite(radius)||radius<=0||!Array.isArray(center)||center.length!==3||!center.every(Number.isFinite))throw Error('Invalid deposit');
 if(solid.length!==p.count||previous.length!==p.count)throw Error('Patch shape mismatch');
 const [nx,ny,nz]=p.dims,indices=[];let capacity=0;
 // Bottom-up fill is an explicit settled loading fixture, not falling/burn coupling.
 for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  if(Math.hypot(p.origin[0]+(x+.5)*p.cellSize-center[0],p.origin[2]+(z+.5)*p.cellSize-center[2])>radius)continue;
  const i=x+nx*(y+ny*z);if(!solid[i]&&previous[i]<1){indices.push(i);capacity+=1-previous[i];}
 }
 let remaining=volume/p.cellSize**3;
 if(remaining>capacity+1e-8)throw Error(`Deposit exceeds patch capacity (${capacity*p.cellSize**3} available world volume); enlarge patch or reduce deposit`);
 const out=previous.slice();for(const i of indices){if(remaining<=0)break;const n=Math.min(remaining,1-out[i]);out[i]+=n;remaining-=n;}return out;
}
// Positive transfers lower coordinate -> upper; negative reverse. Mirrors WGSL.
export function pairTransfer({a,b,axis,solidA,solidB,penetrationA,penetrationB}){
 if(solidA||solidB)return 0;
 if(penetrationA>penetrationB+1e-5)return Math.min(a,1-b);
 if(penetrationB>penetrationA+1e-5)return -Math.min(b,1-a);
 if(penetrationA>0||penetrationB>0)return 0;
 if(axis===1)return -Math.min(b,1-a);
 const diff=a-b;if(Math.abs(diff)<=.5)return 0;
 return Math.sign(diff)*(Math.abs(diff)-.5)*.5;
}
