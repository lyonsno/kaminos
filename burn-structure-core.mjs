import {Box3,Triangle,Vector3} from './lib/three.core.js';
import {LOG_RESIDUE,logMaterialPresent} from './log-consumption.mjs';

export const BURN_STRUCTURE_IDENTITY='kaminos.burn-structure.sections.v1';

// Preparation only: distribute each actual section triangle over the occupied
// thermal cells it touches. Fuel remains in the original object's resident field.
export function mapBurnSections(prepared,{bounds,dimensions,initial}){
  const n=dimensions?.[0],lo=bounds?.min,hi=bounds?.max;
  if(!Number.isSafeInteger(n)||n<=0||dimensions.some(v=>v!==n)||initial?.length!==n**3
    ||![lo,hi].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))
    ||hi.some((v,k)=>v<=lo[k]))throw Error('Structural sections require the original finite cubic material grid');
  const size=hi.map((v,k)=>v-lo[k]),weights=prepared.bonds.map(()=>new Map()),triangle=new Triangle(),box=new Box3();
  const clamp=v=>Math.max(0,Math.min(n-1,v));
  for(const piece of prepared.pieces){
    const a=piece.arrays;
    for(let f=0;f<piece.faceBonds.length;f++){
      const bondIndex=piece.faceBonds[f];
      if(bondIndex<0)continue;
      const bond=prepared.bonds[bondIndex];
      if(!bond)throw Error('Section face references an unknown connection');
      // A section has two sides. Measure it once, from its first owner.
      if(bond.a!==piece.index)continue;
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
    let remaining=0,area=0;const start=mapping.spans[b*2],end=start+mapping.spans[b*2+1];
    for(let i=start;i<end;i++){const weight=mapping.areas[i],fuel=material[mapping.cells[i]*8+5];area+=weight;remaining+=weight*(logMaterialPresent(fuel)?Math.max(0,Math.min(1,(fuel-LOG_RESIDUE)/(1-LOG_RESIDUE))):0);}
    return {...connection,fraction:area?remaining/area:null,remainingArea:remaining,sampledArea:area,mapped:area>0};
  });
}
