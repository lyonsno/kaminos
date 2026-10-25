// Transport has one reusable parcel slot per ground column; overflow remains pending.
export function fallingLayout(p){
 if(!p?.dims?.every(n=>Number.isSafeInteger(n)&&n>0)||p.dims.length!==3||!(p.cellSize>0))throw Error('Invalid falling ash layout');
 const capacity=p.dims[0]*p.dims[2];return {capacity,parcelUnits:8,parcelVolume:(2*p.cellSize)**3,bytes:capacity*32};
}
export function sourceSettings({rate=.006,spread=.2,position=[0,1,1]}={}){
 if(!Number.isFinite(rate)||rate<0||!Number.isFinite(spread)||spread<0||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Invalid falling ash source');
 return {rate,spread,position:[...position]};
}
export function retainedVolume({density,parcels,pendingUnits,cellSize}){
 if(!(cellSize>0)||!Number.isFinite(pendingUnits)||pendingUnits<0||parcels.length%8)throw Error('Invalid falling ash mass');
 let units=pendingUnits;for(const value of density){if(!Number.isFinite(value)||value<0||value>1)throw Error('Invalid density mass');units+=value;}
 for(let i=3;i<parcels.length;i+=8){if(!Number.isFinite(parcels[i])||parcels[i]<0)throw Error('Invalid parcel mass');units+=parcels[i];}
 return units*cellSize**3;
}
