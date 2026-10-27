// Transport has one reusable parcel slot per ground column; overflow remains pending.
export function fallingLayout(p){
 if(!p?.dims?.every(n=>Number.isSafeInteger(n)&&n>0)||p.dims.length!==3||!(p.cellSize>0))throw Error('Invalid falling ash layout');
 const capacity=p.dims[0]*p.dims[2];return {capacity,parcelUnits:8,parcelVolume:(2*p.cellSize)**3,bytes:capacity*32};
}
export function sourceSettings({rate=.006,spread=.2,position=[0,1,1]}={}){
 if(!Number.isFinite(rate)||rate<0||!Number.isFinite(spread)||spread<0||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Invalid falling ash source');
 return {rate,spread,position:[...position]};
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
