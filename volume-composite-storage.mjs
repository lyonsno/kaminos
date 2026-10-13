// Storage adapter for the stationary composite candidate; not yet a live hook.
// Fine: 16 floats/cell, upper-face velocity in cells/reference tick.
// Coarse: 8 floats/site on (N+1)^3 storage, lower-face velocity in local units.
// Fine lower boundary faces require an explicit sidecar: no clamped substitute.
const count=s=>s.reduce((a,b)=>a*b,1);
const index=(q,s)=>q[0]+s[0]*(q[1]+s[1]*q[2]);
function requireArray(a,length,label){
  if(!a||a.length!==length||!a.every(Number.isFinite))throw new Error(`${label} must contain ${length} finite values`);
}
export function createCompositeStorageLayout(grid){
  const {fine,min,cellWidth,shape}=grid.geometry,h=cellWidth/fine.ratio;
  const fineShape=fine.max.map((v,a)=>Math.round((v-fine.min[a])/h));
  const coarseShape=shape.map(n=>n+1),lowerOffsets=[0];
  for(let a=0;a<3;a++)lowerOffsets.push(lowerOffsets[a]+fineShape[(a+1)%3]*fineShape[(a+2)%3]);
  const faces=grid.faces.map(f=>{
    const fineSide=grid.cells[f.a].level===1||(f.b>=0&&grid.cells[f.b].level===1);
    const coarseSide=grid.cells[f.a].level===0||(f.b>=0&&grid.cells[f.b].level===0);
    let fineOffset=null,lowerOffset=null,coarseOffset=null;
    if(fineSide){
      const q=f.center.map((v,a)=>a===f.axis?Math.round((v-fine.min[a])/h):Math.floor((v-fine.min[a])/h));
      if(q[f.axis]===0){const b=(f.axis+1)%3,d=(f.axis+2)%3;lowerOffset=lowerOffsets[f.axis]+q[b]+fineShape[b]*q[d];}
      else{q[f.axis]--;fineOffset=16*index(q,fineShape)+f.axis;}
    }
    if(coarseSide){
      const q=f.center.map((v,a)=>a===f.axis?Math.round((v-min[a])/cellWidth):Math.floor((v-min[a])/cellWidth));
      coarseOffset=8*index(q,coarseShape)+f.axis;
    }
    return {fineOffset,lowerOffset,coarseOffset,sign:f.side,area:f.area,seam:fineSide&&coarseSide};
  });
  return {faces,fineShape,coarseShape,fineWidth:h,coarseWidth:cellWidth,
    fineLength:16*count(fineShape),coarseLength:8*count(coarseShape),lowerOffsets,lowerLength:lowerOffsets[3]};
}
export function gatherCompositeFlux(layout,{fine,coarse,lower,interfaceSource}){
  if(!['fine','coarse'].includes(interfaceSource))throw new Error('explicit interface source (fine or coarse) required');
  requireArray(fine,layout.fineLength,'fine');requireArray(coarse,layout.coarseLength,'coarse');requireArray(lower,layout.lowerLength,'fine lower faces');
  return Float64Array.from(layout.faces,m=>{
    const fromFine=m.fineOffset!==null||m.lowerOffset!==null;
    const v=fromFine&&(!m.seam||interfaceSource==='fine')?
      (m.fineOffset!==null?fine[m.fineOffset]:lower[m.lowerOffset])*layout.fineWidth:coarse[m.coarseOffset];
    return v*m.area*m.sign;
  });
}
export function scatterCompositeFlux(layout,flux,{fine,coarse}){
  requireArray(flux,layout.faces.length,'flux');requireArray(fine,layout.fineLength,'fine');requireArray(coarse,layout.coarseLength,'coarse');
  // Double arithmetic keeps subface summation independent of source array type.
  // The eventual GPU writer must use a gather per destination, never raced +=.
  const near=Float64Array.from(fine),outer=Float64Array.from(coarse),lower=new Float64Array(layout.lowerLength);
  for(let i=0;i<near.length;i+=16)near.fill(0,i,i+3);
  for(let i=0;i<outer.length;i+=8)outer.fill(0,i,i+3);
  layout.faces.forEach((m,i)=>{
    const q=flux[i]*m.sign;
    if(m.fineOffset!==null)near[m.fineOffset]+=q/(layout.fineWidth**3);
    if(m.lowerOffset!==null)lower[m.lowerOffset]+=q/(layout.fineWidth**3);
    if(m.coarseOffset!==null)outer[m.coarseOffset]+=q/(layout.coarseWidth**2);
  });
  return {fine:near,coarse:outer,lower};
}
