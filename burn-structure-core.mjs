import {Box3,Triangle,Vector3} from './lib/three.core.js';
import {LOG_RESIDUE,logMaterialPresent} from './log-consumption.mjs';

export const BURN_STRUCTURE_IDENTITY='kaminos.burn-structure.sections.v1';

// The material lattice keeps its addresses for its whole lifetime. Ownership is
// prepared once, independently of fuel, so consuming a cell never moves its state.
export function mapBurnRegions(prepared,{bounds,dimensions,initial}){
 const lo=bounds?.min,hi=bounds?.max,n=dimensions?.[0],count=prepared.cells?.length;
 if(!Number.isSafeInteger(n)||n<1||dimensions.length!==3||dimensions.some(v=>v!==n)||initial?.length!==n**3
  ||![lo,hi].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||hi.some((v,k)=>v<=lo[k]))throw Error('Regions require a finite original cubic material field');
 if(!count||prepared.pieces?.length!==count||prepared.pieces.some((p,i)=>p.index!==i||!p.bounds||!['min','max'].every(k=>p.bounds[k]?.length===3&&p.bounds[k].every(Number.isFinite))||p.bounds.max.some((v,k)=>v<=p.bounds.min[k])))throw Error('Regions require ordered finite prepared piece bounds');
 const owners=new Uint32Array(initial.length),counts=new Uint32Array(count),buckets=Array.from({length:count},()=>[]);
 for(let i=0;i<initial.length;i++){
  if(initial[i]!==0&&initial[i]!==1)throw Error('Original material occupancy must be binary');
  const point=[i%n,Math.floor(i/n)%n,Math.floor(i/(n*n))].map((v,k)=>lo[k]+(v+.5)*(hi[k]-lo[k])/n);
  let region=0,best=Infinity;
  for(const p of prepared.pieces){const distance=point.reduce((sum,v,k)=>sum+Math.max(p.bounds.min[k]-v,0,v-p.bounds.max[k])**2,0);if(distance<best){best=distance;region=p.index;}}
  owners[i]=region;if(initial[i]){counts[region]++;buckets[region].push(i);}
 }
 if(initial.some(v=>v===1)){
  for(let r=0;r<count;r++)if(!counts[r]){
   const b=prepared.pieces[r].bounds;let nearest=-1,best=Infinity;
   for(let i=0;i<initial.length;i++)if(initial[i]){
    const point=[i%n,Math.floor(i/n)%n,Math.floor(i/(n*n))].map((v,k)=>lo[k]+(v+.5)*(hi[k]-lo[k])/n);
    const d2=point.reduce((sum,v,k)=>sum+Math.max(b.min[k]-v,0,v-b.max[k])**2,0);if(d2<best){best=d2;nearest=i;}
   }
   if(nearest>=0){counts[r]=1;buckets[r].push(nearest);}
  }
 }
 const spans=new Uint32Array(count*2),cells=[];
 for(let i=0;i<count;i++){spans[i*2]=cells.length;spans[i*2+1]=counts[i];cells.push(...buckets[i]);}
 return {owners,counts,spans,cells:Uint32Array.from(cells),identity:'original-material-nearest-prepared-region-v1'};
}

// Preparation only: distribute each actual section triangle over the occupied
// thermal cells it touches. Fuel remains in the original object's resident field.
export function mapBurnSections(prepared,{bounds,dimensions,initial}){
  const n=dimensions?.[0],lo=bounds?.min,hi=bounds?.max;
  if(!Number.isSafeInteger(n)||n<=0||dimensions.some(v=>v!==n)||initial?.length!==n**3
    ||![lo,hi].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))
    ||hi.some((v,k)=>v<=lo[k]))throw Error('Structural sections require the original finite cubic material grid');
  const size=hi.map((v,k)=>v-lo[k]),weights=prepared.bonds.map(()=>new Map()),triangle=new Triangle(),box=new Box3();
  const clamp=v=>Math.max(0,Math.min(n-1,v));
  const ownerWithFaces=prepared.bonds.map((bond,bondIndex)=>prepared.pieces[bond.a]?.faceBonds?.includes(bondIndex)?bond.a:bond.b);
  for(const piece of prepared.pieces){
    const a=piece.arrays;
    for(let f=0;f<piece.faceBonds.length;f++){
      const bondIndex=piece.faceBonds[f];
      if(bondIndex<0)continue;
      const bond=prepared.bonds[bondIndex];
      if(!bond)throw Error('Section face references an unknown connection');
      // A section has two sides. Measure it once, from whichever owner carries the cap faces.
      if(ownerWithFaces[bondIndex]!==piece.index)continue;
      for(const [point,j]of [[triangle.a,0],[triangle.b,1],[triangle.c,2]])
        point.fromArray(a.positions,a.indices[f*3+j]*3);
      const area=triangle.getArea();if(!(area>0))continue;
      const points=[triangle.a,triangle.b,triangle.c],min=[0,1,2].map(k=>Math.min(...points.map(p=>p.getComponent(k)))),max=[0,1,2].map(k=>Math.max(...points.map(p=>p.getComponent(k))));
      const start=min.map((v,k)=>clamp(Math.floor((v-lo[k])*n/size[k]-1e-6))),end=max.map((v,k)=>clamp(Math.floor((v-lo[k])*n/size[k]+1e-6))),hits=[];
      for(let z=start[2];z<=end[2];z++)for(let y=start[1];y<=end[1];y++)for(let x=start[0];x<=end[0];x++){
        const cell=x+n*(y+n*z);if(!initial[cell])continue;
        box.min.fromArray([x,y,z].map((v,k)=>lo[k]+v*size[k]/n));
        box.max.fromArray([x,y,z].map((v,k)=>lo[k]+(v+1)*size[k]/n));
        if(box.intersectsTriangle(triangle))hits.push(cell);
      }
      for(const cell of hits)weights[bondIndex].set(cell,(weights[bondIndex].get(cell)??0)+area/hits.length);
    }
  }
  const hasOccupied=initial.some(v=>v===1);
  if(hasOccupied){
    const {owners}=mapBurnRegions(prepared,{bounds,dimensions,initial});
    for(let b=0;b<weights.length;b++)if(!weights[b].size){
      const bond=prepared.bonds[b],ca=prepared.cells[bond.a],cb=prepared.cells[bond.b];
      const mid=[0,1,2].map(k=>((ca.position[k]+(bond.anchorA?.[k]??0))+(cb.position[k]+(bond.anchorB?.[k]??0)))*.5);
      let nearest=-1,best=Infinity;
      for(let pass=0;pass<2&&nearest<0;pass++)for(let i=0;i<initial.length;i++)if(initial[i]&&(pass===1||owners[i]===bond.a||owners[i]===bond.b)){
        const point=[i%n,Math.floor(i/n)%n,Math.floor(i/(n*n))].map((v,k)=>lo[k]+(v+.5)*size[k]/n);
        const d2=point.reduce((s,v,k)=>s+(v-mid[k])**2,0);if(d2<best){best=d2;nearest=i;}
      }
      if(nearest>=0)weights[b].set(nearest,bond.area);
    }
  }
  const spans=new Uint32Array(prepared.bonds.length*2),cells=[],areas=[],unmapped=[];
  for(let b=0;b<weights.length;b++){
    spans[b*2]=cells.length;spans[b*2+1]=weights[b].size;
    if(!weights[b].size)unmapped.push(prepared.bonds[b].id);
    for(const [cell,area]of [...weights[b]].sort((a,b)=>a[0]-b[0])){cells.push(cell);areas.push(area);}
  }
  return {identity:BURN_STRUCTURE_IDENTITY,dimensions:[...dimensions],spans,cells:Uint32Array.from(cells),areas:Float32Array.from(areas),
    connections:prepared.bonds.map(b=>({id:b.id,a:b.a,b:b.b,kind:b.kind,area:b.area})),
    receipt:{sampling:'section-triangle-area-distributed-over-touched-occupied-cells',unmapped,materialCellCount:initial.length,samples:cells.length}};
}

export function sectionReference(mapping,material){
  if(material.length!==mapping.dimensions[0]**3*8||!Array.from(material).every(Number.isFinite))throw Error('Complete finite original material state required');
  return mapping.connections.map((connection,b)=>{
    let remaining=0,area=0,charArea=0;const start=mapping.spans[b*2],end=start+mapping.spans[b*2+1];
    for(let i=start;i<end;i++){const weight=mapping.areas[i],cell=mapping.cells[i]*8,fuel=material[cell+5];area+=weight;
      const retained=weight*(logMaterialPresent(fuel)?Math.max(0,Math.min(1,(fuel-LOG_RESIDUE)/(1-LOG_RESIDUE))):0);
      remaining+=retained;charArea+=(weight-retained)+retained*Math.max(0,Math.min(1,material[cell+1]));
    }
    return {...connection,fraction:area?remaining/area:null,char:remaining>0?charArea/area:0,remainingArea:remaining,sampledArea:area,mapped:area>0};
  });
}
