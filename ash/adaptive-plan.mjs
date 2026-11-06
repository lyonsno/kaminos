import {patchLayout} from './gpu-plan.mjs';
const product=a=>a.reduce((x,y)=>x*y,1),linear=(q,d)=>q[0]+d[0]*(q[1]+d[1]*q[2]);
const coords=(i,d)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))];
export function createAdaptiveLayout({cellSize,bounds,refinement}){
 if(refinement?.ratio!==2||refinement.mode!=='adaptive')throw Error('Invalid automatic ash refinement');
 const width=8,base=patchLayout({cellSize:cellSize*2,bounds,tileSize:width});
 const dims=base.dims.map(n=>n*2),pageDims=dims.map(n=>Math.ceil(n/width)),pages=product(pageDims);
 const fraction=refinement.fineFraction??.125;
 if(!Number.isFinite(fraction)||fraction<=0||fraction>1)throw Error('Fine ash capacity fraction must lie in (0,1]');
 const capacity=refinement.fineCapacity??Math.ceil(pages*fraction);
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>pages)throw Error('Fine ash capacity exceeds field pages');
 const offset=Math.ceil(base.count/64)*64,tileOffset=base.tiles.count;
 const pool={width,cells:width**3,capacity,offset,tileOffset,pageDims,pages};
 const count=offset+capacity*pool.cells,tileCount=tileOffset+capacity;
 const records=[];let faceWords=0;
 for(let t=0;t<tileCount;t++){
  const fine=t>=tileOffset,c=fine?[0,0,0]:coords(t,base.tiles.dims);
  // Twenty quads is the coarse worst case: four top and four per side.
  const faceCapacity=fine?pool.cells*5:product(c.map((n,axis)=>Math.min(width,base.dims[axis]-n*width)))*20;
  records.push({region:fine?1:0,coord:c,neighbors:[],neighborOffset:0,faceOffset:faceWords,faceCapacity});faceWords+=faceCapacity;
 }
 return {adaptive:true,cellSize,bounds:base.bounds,origin:base.origin,dims,count,refinement:structuredClone(refinement),pool,
  regions:[{scale:2,low:[0,0,0],high:dims,layout:base,offset:0,tileOffset:0}],
  tiles:{width,count:tileCount,cellsPerTile:pool.cells,groupsPerTile:8},tileRecords:records,tileNeighbors:[],faceWords};
}
export function adaptiveIndex(p,q){
 if(q.some((n,a)=>n<0||n>=p.dims[a]))return -1;
 const {pool}=p,pc=q.map(n=>Math.floor(n/pool.width)),page=linear(pc,pool.pageDims),slot=p.residency?.map[page]??0;
 if(slot)return pool.offset+(slot-1)*pool.cells+linear(q.map(n=>n%pool.width),[pool.width,pool.width,pool.width]);
 return linear(q.map(n=>Math.floor(n/2)),p.regions[0].layout.dims);
}
export function adaptiveCell(p,i){
 const {pool}=p;let coord,size,tile;
 if(i<0||i>=p.count)return {coord:[0,0,0],size:0,tile:-1,owned:false};
 if(i< p.regions[0].layout.count){
  const c=coords(i,p.regions[0].layout.dims);coord=c.map(n=>n*2);size=2;tile=linear(c.map(n=>Math.floor(n/p.tiles.width)),p.regions[0].layout.tiles.dims);
 }else if(i>=pool.offset){
  const slot=Math.floor((i-pool.offset)/pool.cells),page=p.residency?.slots[slot]??0;
  if(!page)return {coord:[0,0,0],size:0,tile:pool.tileOffset+slot,owned:false};
  const pc=coords(page-1,pool.pageDims),c=coords((i-pool.offset)%pool.cells,[pool.width,pool.width,pool.width]);
  coord=c.map((n,a)=>n+pc[a]*pool.width);size=1;tile=pool.tileOffset+slot;
 }else return {coord:[0,0,0],size:0,tile:-1,owned:false};
 return {coord,size,tile,owned:adaptiveIndex(p,coord)===i};
}
export function adaptiveView(p,residency){
 const {map,slots}=residency??{};
 if(!map||map.length!==p.pool.pages||!slots||slots.length!==p.pool.capacity)throw Error('Invalid adaptive ash residency shape');
 const seen=new Set();
 for(let page=0;page<map.length;page++)if(map[page]){
  const slot=map[page]-1;
  if(!Number.isSafeInteger(slot)||slot<0||slot>=slots.length||seen.has(slot)||slots[slot]!==page+1)throw Error('Invalid adaptive ash owner map');seen.add(slot);
 }
 for(let slot=0;slot<slots.length;slot++)if(slots[slot]&&(slots[slot]>map.length||map[slots[slot]-1]!==slot+1))throw Error('Invalid adaptive ash inverse map');
 return {...p,residency:{map:Array.from(map),slots:Array.from(slots)}};
}
