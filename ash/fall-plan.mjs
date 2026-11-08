// Transport has one reusable parcel slot per ground column; overflow remains pending.
export function fallingLayout(p){
 if(!p?.dims?.every(n=>Number.isSafeInteger(n)&&n>0)||p.dims.length!==3||!(p.cellSize>0))throw Error('Invalid falling ash layout');
 const scale=p.hierarchy?Math.max(1,p.regions[0].scale/2):p.detailPool?2:1;
 let capacity=Math.ceil(p.dims[0]/scale)*Math.ceil(p.dims[2]/scale),reservedBytes;
 if(p.hierarchy&&p.refinement.airBudgetMiB!==undefined){
  const budget=p.refinement.airBudgetMiB*1048576,metadata=p.tiles.count*64+256;
  if(!(budget>metadata+36.1875&&Number.isFinite(budget)))throw Error('Airborne ash budget cannot cover topology and a parcel');
  capacity=Math.floor((budget-metadata)/36.1875);reservedBytes=metadata+capacity*36+Math.ceil(capacity/64)*12;
  if(reservedBytes>budget){capacity--;reservedBytes=metadata+capacity*36+Math.ceil(capacity/64)*12;}
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>0xffffffff)throw Error('Airborne ash budget exceeds GPU address capacity');
 }
 const parcelUnits=p.hierarchy?8*((p.refinement.transportCellSize??p.cellSize)/p.cellSize)**3:8*scale**3;
 if(!(Math.fround(parcelUnits)>0&&Number.isFinite(Math.fround(parcelUnits))))throw Error('Ash transport parcel exceeds numeric capacity');
 return {capacity,parcelUnits,parcelVolume:parcelUnits*p.cellSize**3,bytes:capacity*32,...(reservedBytes===undefined?{}:{reservedBytes})};
}
export function sourceSettings({rate=.006,spread=.2,position=[0,1,1],halfExtents=null}={}){
 if(!Number.isFinite(rate)||rate<0||!Number.isFinite(spread)||spread<0||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Invalid falling ash source');
 if(halfExtents!==null&&(!Array.isArray(halfExtents)||halfExtents.length!==2||!halfExtents.every(v=>Number.isFinite(v)&&v>0)))throw Error('Invalid fallout extent');
 return {rate,spread,position:[...position],...(halfExtents?{halfExtents:[...halfExtents]}:{})};
}
// Reconstruct derived scheduling masks from authoritative parcel mass on load.
export function fallingGroupState(particles,capacity){
 if(!Number.isSafeInteger(capacity)||capacity<1||particles.length!==capacity*8)throw Error('Invalid parcel group shape');
 const groups=Math.ceil(capacity/64),packed=new Uint32Array(groups*3+4),visible=[];
 for(let i=0;i<capacity;i++){const amount=particles[i*8+3];if(!Number.isFinite(amount)||amount<0)throw Error('Invalid parcel group mass');if(amount>0){packed[Math.floor(i/64)*2+Math.floor(i%64/32)]|=1<<(i%32);visible.push(i);}}
 return {packed,visible:Uint32Array.from(visible)};
}
export function retainedVolume({density,parcels,pendingUnits,cellSize}){
 if(!(cellSize>0)||!Number.isFinite(pendingUnits)||pendingUnits<0||parcels.length%8)throw Error('Invalid falling ash mass');
 let units=pendingUnits;for(const value of density){if(!Number.isFinite(value)||value<0||value>1)throw Error('Invalid density mass');units+=value;}
 for(let i=3;i<parcels.length;i+=8){if(!Number.isFinite(parcels[i])||parcels[i]<0)throw Error('Invalid parcel mass');units+=parcels[i];}
 return units*cellSize**3;
}
