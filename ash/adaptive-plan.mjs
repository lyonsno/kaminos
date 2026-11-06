import {patchLayout} from './gpu-plan.mjs';
const product=a=>a.reduce((x,y)=>x*y,1),linear=(q,d)=>q[0]+d[0]*(q[1]+d[1]*q[2]);
const coords=(i,d)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))];
export function createAdaptiveLayout({cellSize,bounds,refinement}){
 if(refinement?.ratio!==2||refinement.mode!=='adaptive')throw Error('Invalid automatic ash refinement');
 if(refinement.levels!==undefined&&![2,3].includes(refinement.levels))throw Error('Adaptive ash levels must be 2 or 3');
 const deeper=refinement.levels===3,scale=deeper?2:1;
 const width=8,base=patchLayout({cellSize:cellSize*2,bounds,tileSize:width});
 const dims=base.dims.map(n=>n*2*scale),pageDims=dims.map(n=>Math.ceil(n/(width*scale))),pages=product(pageDims);
 const fraction=refinement.fineFraction??.125;
 if(!Number.isFinite(fraction)||fraction<=0||fraction>1)throw Error('Fine ash capacity fraction must lie in (0,1]');
 const capacity=refinement.fineCapacity??Math.ceil(pages*fraction);
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>pages)throw Error('Fine ash capacity exceeds field pages');
 const offset=Math.ceil(base.count/64)*64,tileOffset=base.tiles.count;
 const pool={width,cells:width**3,capacity,offset,tileOffset,pageDims,pages,...(deeper?{scale}:{} )};
 let count=offset+capacity*pool.cells,tileCount=tileOffset+capacity,detailPool=null;
 if(deeper){
  const pageDims=dims.map(n=>Math.ceil(n/width)),pages=product(pageDims);
  // The extra allowance is relative to the existing pool, not all possible
  // finest pages (which would silently multiply reservation by eight).
  const capacity=refinement.detailCapacity??pool.capacity;
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>pages)throw Error('Detail ash capacity exceeds field pages');
  detailPool={width,cells:width**3,scale:1,capacity,offset:count,tileOffset:tileCount,pageDims,pages};
  count+=capacity*detailPool.cells;tileCount+=capacity;
 }
 const records=[];let faceWords=0;
 for(let t=0;t<tileCount;t++){
  const fine=t>=tileOffset,finest=deeper?t>=detailPool.tileOffset:fine,c=fine?[0,0,0]:coords(t,base.tiles.dims);
  // Twenty quads is the coarse worst case: four top and four per side.
  const faceCapacity=fine?pool.cells*(finest?5:20):product(c.map((n,axis)=>Math.min(width,base.dims[axis]-n*width)))*20;
  records.push({region:fine?1:0,coord:c,neighbors:[],neighborOffset:0,faceOffset:faceWords,faceCapacity});faceWords+=faceCapacity;
 }
 return {adaptive:true,cellSize:cellSize/scale,...(deeper?{requestedCellSize:cellSize,detailPool}:{}),bounds:base.bounds,origin:base.origin,dims,count,refinement:structuredClone(refinement),pool,
  regions:[{scale:2*scale,low:[0,0,0],high:dims,layout:base,offset:0,tileOffset:0}],
  tiles:{width,count:tileCount,cellsPerTile:pool.cells,groupsPerTile:8},tileRecords:records,tileNeighbors:[],faceWords};
}
export function adaptiveIndex(p,q){
 if(q.some((n,a)=>n<0||n>=p.dims[a]))return -1;
 const pools=p.detailPool?[['detail',p.detailPool],['base',p.pool]]:[['base',p.pool]];
 for(const [key,pool]of pools){
  const scale=pool.scale??1,c=q.map(n=>Math.floor(n/scale)),pc=c.map(n=>Math.floor(n/pool.width)),page=linear(pc,pool.pageDims);
  const slot=(key==='detail'?p.residency?.detail:p.residency)?.map[page]??0;
  if(slot)return pool.offset+(slot-1)*pool.cells+linear(c.map(n=>n%pool.width),[pool.width,pool.width,pool.width]);
 }
 return linear(q.map(n=>Math.floor(n/p.regions[0].scale)),p.regions[0].layout.dims);
}
export function adaptiveCell(p,i){
 let coord,size,tile;
 if(i<0||i>=p.count)return {coord:[0,0,0],size:0,tile:-1,owned:false};
 if(i<p.regions[0].layout.count){
  const c=coords(i,p.regions[0].layout.dims);size=p.regions[0].scale;coord=c.map(n=>n*size);tile=linear(c.map(n=>Math.floor(n/p.tiles.width)),p.regions[0].layout.tiles.dims);
 }else{
  const detail=p.detailPool&&i>=p.detailPool.offset,pool=detail?p.detailPool:p.pool;
  if(i<pool.offset)return {coord:[0,0,0],size:0,tile:-1,owned:false};
  const slot=Math.floor((i-pool.offset)/pool.cells),page=(detail?p.residency?.detail:p.residency)?.slots[slot]??0;
  if(!page)return {coord:[0,0,0],size:0,tile:pool.tileOffset+slot,owned:false};
  const pc=coords(page-1,pool.pageDims),c=coords((i-pool.offset)%pool.cells,[pool.width,pool.width,pool.width]);
  size=pool.scale??1;coord=c.map((n,a)=>(n+pc[a]*pool.width)*size);tile=pool.tileOffset+slot;
 }
 return {coord,size,tile,owned:adaptiveIndex(p,coord)===i};
}
// The same neighborhood is checked by GPU admission and checkpoint validation.
export function detailParents(p,page){
 const low=coords(page,p.detailPool.pageDims).map(n=>n*8),result=new Set();
 for(const z of [-1,4,8])for(const y of [-1,4,8])for(const x of [-1,4,8]){
  const q=low.map((n,a)=>n+[x,y,z][a]);if(q.some((n,a)=>n<0||n>=p.dims[a]))continue;
  result.add(linear(q.map(n=>Math.floor(n/16)),p.pool.pageDims));
 }
 return [...result];
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
 let detail;
 if(p.detailPool){
  const local={...p,pool:p.detailPool,detailPool:null};detail=adaptiveView(local,residency.detail).residency;
  for(let page=0;page<detail.map.length;page++)if(detail.map[page]&&detailParents(p,page).some(parent=>!map[parent]))throw Error('Invalid detail ash parent balance');
 }
 return {...p,residency:{map:Array.from(map),slots:Array.from(slots),...(detail?{detail}:{})}};
}
