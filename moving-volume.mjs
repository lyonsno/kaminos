const finite3=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
export function followingDomainShift({anchor,origin,target,current,scale,grid}) {
  if(![anchor,origin,target,current].every(finite3)||!Number.isFinite(scale)||scale<=0||!Number.isInteger(grid)||grid<=0)throw Error('Following domain requires finite poses and positive grid/scale');
  const cellSize=2*scale/grid;
  const cells=target.map((v,i)=>Math.round((origin[i]+v-anchor[i]-current[i])/cellSize)||0);
  return {cells,translation:current.map((v,i)=>v+cells[i]*cellSize),cellSize};
}
export function shiftedCellIndex(cell,shift,dims) {
  const q=cell.map((v,i)=>v+shift[i]);
  return q.some((v,i)=>v<0||v>=dims[i])?null:q[0]+dims[0]*(q[1]+dims[1]*q[2]);
}
export function emittedMotionVelocity({displacement,grid,scale,backtraceScale}) {
  if(!finite3(displacement)||![grid,scale,backtraceScale].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid emitted motion units');
  return displacement.map(v=>v*grid/(2*scale*backtraceScale));
}
