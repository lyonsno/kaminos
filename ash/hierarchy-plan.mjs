import {patchLayout} from './gpu-plan.mjs';
const product=a=>a.reduce((x,y)=>x*y,1),linear=(q,d)=>q[0]+d[0]*(q[1]+d[1]*q[2]);
const coords=(i,d)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))];

// A single brick pool serves every depth. Eight child links belong to each
// resident brick/root tile; no address map covers the hypothetical fine world.
export function createHierarchyLayout({cellSize,bounds,refinement}){
 const background=refinement.backgroundCellSize,budget=refinement.budgetMiB*1048576;
 if(!(cellSize>0&&Number.isFinite(cellSize)&&background>0&&Number.isFinite(background)&&budget>0&&Number.isFinite(budget)))throw Error('Invalid hierarchical ash precision or budget');
 if(refinement.targetPixels!==undefined&&(!(refinement.targetPixels>0)||!Number.isFinite(refinement.targetPixels)))throw Error('Invalid ash projected detail target');
 const depth=Math.max(0,Math.ceil(Math.log2(background/cellSize)-1e-12)),scale=2**depth;
 const base=patchLayout({cellSize:background,bounds,tileSize:8}),roots=base.tiles.count;
 if(Math.max(...base.dims)*scale>2**24)throw Error('Requested ash precision exceeds float32 field-coordinate capacity');
 const dims=base.dims.map(n=>n*scale),pitch=background/scale;
 // Material, flux, collision, masks, headers, work lists and tree metadata.
 // Airborne parcels and borrowed object-local collider caches are separate.
 const fixed=base.count*20+roots*(512*8+256)+4096;
 const perBrick=512*28+32+32+32+32+32+32;
 if(budget<fixed+perBrick)throw Error('Ash storage budget cannot cover the background and one receiving brick');
 let possible=0,layer=roots;for(let n=0;n<depth;n++){layer*=8;possible+=layer;if(possible>=Math.floor((budget-fixed)/perBrick))break;}
 const capacity=Math.min(Math.floor((budget-fixed)/perBrick),possible),count=base.count+capacity*512,tileCount=roots+capacity;
 if(!Number.isSafeInteger(count)||count>0xffffffff)throw Error('Ash storage exceeds GPU address capacity');
 const records=Array.from({length:tileCount},(_,tile)=>({region:tile<roots?0:1,coord:tile<roots?coords(tile,base.tiles.dims):[0,0,0],neighbors:[],neighborOffset:0,faceOffset:tile*512*20,faceCapacity:512*20}));
 return {hierarchy:{depth,capacity,roots,backgroundCellSize:background,reservedBytes:fixed+capacity*perBrick,budgetBytes:budget,metadataWords:tileCount*37+capacity+37},cellSize:pitch,requestedCellSize:background/2,bounds:base.bounds,origin:base.origin,dims,count,
  refinement:structuredClone(refinement),regions:[{scale,low:[0,0,0],high:dims,layout:base,offset:0,tileOffset:0}],
  tiles:{width:8,count:tileCount,cellsPerTile:512,groupsPerTile:8},tileRecords:records,tileNeighbors:[],faceWords:tileCount*512*20};
}
export function hierarchyNode(p,tile){
 const h=p.hierarchy;if(tile<h.roots){const c=coords(tile,p.regions[0].layout.tiles.dims);return [...c.map(n=>n*8*p.regions[0].scale),p.regions[0].scale,0,0,0,1];}
 return p.residency?.nodes?.slice(tile*8,tile*8+8)??[0,0,0,0,0,0,0,0];
}
export function hierarchyIndex(p,q){
 if(q.some((n,a)=>n<0||n>=p.dims[a]))return -1;
 const base=p.regions[0].layout,c=q.map(n=>Math.floor(n/p.regions[0].scale));let tile=linear(c.map(n=>Math.floor(n/8)),base.tiles.dims);
 for(let depth=0;depth<=p.hierarchy.depth;depth++){
  const node=hierarchyNode(p,tile),local=q.map((n,a)=>Math.floor((n-node[a])/node[3]));
  const child=p.residency?.children?.[tile*8+linear(local.map(n=>Math.floor(n/4)),[2,2,2])]??0;
  if(child){tile=p.hierarchy.roots+child-1;continue;}
  return tile<p.hierarchy.roots?linear(c,base.dims):base.count+(tile-p.hierarchy.roots)*512+linear(local,[8,8,8]);
 }
 throw Error('Cyclic ash hierarchy');
}
export function hierarchyCell(p,i){
 const base=p.regions[0].layout;
 if(i<0||i>=p.count)return {coord:[0,0,0],size:0,tile:-1,owned:false};
 let tile,coord,size;
 if(i<base.count){const c=coords(i,base.dims);size=p.regions[0].scale;coord=c.map(n=>n*size);tile=linear(c.map(n=>Math.floor(n/8)),base.tiles.dims);}
 else{tile=p.hierarchy.roots+Math.floor((i-base.count)/512);const node=hierarchyNode(p,tile);if(!node[7])return {coord:[0,0,0],size:0,tile,owned:false};size=node[3];coord=coords((i-base.count)%512,[8,8,8]).map((n,a)=>node[a]+n*size);}
 return {coord,size,tile,owned:hierarchyIndex(p,coord)===i};
}
export function hierarchyView(p,residency){
 const h=p.hierarchy,T=p.tiles.count;
 if(!Array.isArray(residency?.children)||residency.children.length!==T*8||!Array.isArray(residency?.nodes)||residency.nodes.length!==T*8)throw Error('Invalid ash hierarchy shape');
 if([...residency.nodes,...residency.children].some(n=>!Number.isSafeInteger(n)||n<0||n>0xffffffff))throw Error('Invalid ash hierarchy metadata');
 const seen=new Set(),view={...p,residency};
 for(let t=0;t<h.roots;t++)if(hierarchyNode(p,t).some((n,i)=>residency.nodes[t*8+i]!==n))throw Error('Invalid ash hierarchy root');
 for(let parent=0;parent<T;parent++)for(let octant=0;octant<8;octant++){
  const slot=residency.children[parent*8+octant];if(!slot)continue;
  if(!Number.isSafeInteger(slot)||slot<1||slot>h.capacity||seen.has(slot))throw Error('Invalid ash child owner');seen.add(slot);
  const node=hierarchyNode(view,h.roots+slot-1),owner=hierarchyNode(view,parent),half=owner[3]/2,low=coords(octant,[2,2,2]).map((n,a)=>owner[a]+n*4*owner[3]);
  if(!owner[7]||!node[7]||node[3]!==half||node[4]!==owner[4]+1||node[4]>h.depth||node[5]!==parent+1||node[6]!==octant||node.slice(0,3).some((n,a)=>n!==low[a]))throw Error('Invalid ash hierarchy parent');
 }
 for(let slot=0;slot<h.capacity;slot++)if(!!residency.nodes[(h.roots+slot)*8+7]!==seen.has(slot+1))throw Error('Orphan ash hierarchy brick');
 // Validate the same 2:1 boundary requirement used during GPU admission.
 for(const slot of seen){const n=hierarchyNode(view,h.roots+slot-1);for(const z of [-1,4,8])for(const y of [-1,4,8])for(const x of [-1,4,8]){const q=[x,y,z].map((v,a)=>n[a]+(v===-1?-1:v*n[3]));const i=hierarchyIndex(view,q);if(i>=0&&hierarchyCell(view,i).size>n[3]*2)throw Error('Invalid ash hierarchy balance');}}
 return view;
}
