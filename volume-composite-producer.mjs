// Intake for the stationary composite candidate. This does not enable joined
// transport. Callers supply the EFFECTIVE masks used by both producers, after
// emitter-wall composition; a disabled mask is an explicit full zero field.
import {createCompositeGrid} from './volume-composite-grid.mjs';
const count=s=>s.reduce((a,b)=>a*b,1);
const index=(q,s)=>q[0]+s[0]*(q[1]+s[1]*q[2]);
function shapeEqual(a,b){return a?.length===3&&a.every((v,i)=>Number.isInteger(v)&&v>0&&v===b[i]);}
function mask(field,shape,label){
  if(!shapeEqual(field?.shape,shape))throw new Error(`${label} solid shape mismatch`);
  if(!(field.cells instanceof Uint8Array)||field.cells.length!==count(shape))throw new Error(`${label} solid coverage mismatch`);
  if(typeof field.revision!=='string'||!field.revision.length)throw new Error(`${label} solid revision required (including disabled state)`);
  return field.cells.slice();
}
export function createCompositeProducerLayout({geometry,fineSolids,coarseSolids}){
  // Validate geometric ownership before interpreting producer arrays.
  const h=geometry.cellWidth/geometry.fine.ratio;
  const fineShape=geometry.fine.max.map((v,a)=>Math.round((v-geometry.fine.min[a])/h));
  const near=mask(fineSolids,fineShape,'fine'),outer=mask(coarseSolids,geometry.shape,'coarse');
  const inFine=p=>p.every((v,a)=>v>=geometry.fine.min[a]&&v<geometry.fine.max[a]);
  const grid=createCompositeGrid({...geometry,solid:p=>{
    const refined=inFine(p),origin=refined?geometry.fine.min:geometry.min??[0,0,0],w=refined?h:geometry.cellWidth;
    const q=p.map((v,a)=>Math.round((v-origin[a])/w-.5));
    return (refined?near:outer)[index(q,refined?fineShape:geometry.shape)]!==0;
  }});
  // Four uints per leaf: local fine XYZ and whether the leaf is fine. Never
  // index the target with cell.index: those indices are outer-origin relative.
  const targetCoordinates=new Uint32Array(grid.cells.length*4);
  grid.cells.forEach((c,i)=>{
    if(c.level!==1)return;
    const q=c.center.map((v,a)=>Math.round((v-geometry.fine.min[a])/h-.5));
    if(q.some((v,a)=>v<0||v>=fineShape[a]))throw new Error('fine target coordinate outside producer');
    targetCoordinates.set([...q,1],4*i);
  });
  return {grid,fineShape,targetCoordinates,solidRevisions:{fine:fineSolids.revision,coarse:coarseSolids.revision}};
}
export function assertCompositeSolidRevisions(layout,revisions){
  if(!revisions)throw new Error('effective solid revisions required');
  if(revisions.fine!==layout.solidRevisions.fine||revisions.coarse!==layout.solidRevisions.coarse)
    throw new Error('effective solid revision changed; rebuild composite topology');
}
export function gatherCompositeTarget(layout,values){
  if(!(values instanceof Float32Array)||values.length!==count(layout.fineShape))throw new Error('fine target coverage mismatch');
  if(!values.every(Number.isFinite))throw new Error('fine target must be finite');
  return Float32Array.from(layout.grid.cells,(_,i)=>{
    const q=layout.targetCoordinates.subarray(4*i,4*i+4);
    return q[3]?values[index(q,layout.fineShape)]:0;
  });
}
