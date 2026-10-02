// Offline geometry/storage investigation. Counts are not GPU timings or bandwidth.
export function auditNeighborhood(points, {boundsMin:lo,boundsMax:hi,gridDimensions:dims,radius:h}) {
  if(!Array.isArray(points)||points.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)))) throw Error('positions must be finite xyz arrays');
  if(!Number.isFinite(h)||h<=0)throw Error('positive radius required');
  if(!Array.isArray(dims)||dims.length!==3||dims.some(x=>!Number.isSafeInteger(x)||x<1))throw Error('positive integer dimensions required');
  if(!Array.isArray(lo)||!Array.isArray(hi)||lo.length!==3||hi.length!==3||lo.some((x,a)=>!Number.isFinite(x)||!Number.isFinite(hi[a])||hi[a]<=x))throw Error('finite ordered bounds required');
  const n=points.length,cellCount=dims.reduce((a,b)=>a*b,1),width=lo.map((x,a)=>(hi[a]-x)/dims[a]);
  const searchRadius=width.map(w=>Math.ceil(h/w));
  const heads=new Int32Array(cellCount).fill(-1),next=new Int32Array(n).fill(-1),counts=new Uint32Array(cellCount);
  const coordinates=points.map(p=>p.map((x,a)=>Math.min(dims[a]-1,Math.max(0,Math.floor((x-lo[a])/width[a])))));
  const cellId=(x,y,z)=>x+dims[0]*(y+dims[1]*z);
  for(let i=0;i<n;i++){const c=cellId(...coordinates[i]);next[i]=heads[c];heads[c]=i;counts[c]++;}
  const offsets=new Uint32Array(cellCount+1);
  for(let c=0;c<cellCount;c++)offsets[c+1]=offsets[c]+counts[c];
  const packed=new Uint32Array(n);
  for(let c=0;c<cellCount;c++){let slot=offsets[c];for(let i=heads[c];i>=0;i=next[i])packed[slot++]=i;}
  // This CPU construction deliberately preserves each linked chain's order.
  // A native parallel scatter needs its own identity/order/f32 witness.
  let packedOrderMatchesLinked=true;
  for(let c=0;c<cellCount;c++){let slot=offsets[c];for(let i=heads[c];i>=0;i=next[i])if(packed[slot++]!==i)packedOrderMatchesLinked=false;}
  let candidates=0,prunedCandidates=0,acceptedPairs=0,acceptedAfterCellRejection=0,visitedCells=0,nonemptyCellsVisited=0,maxAcceptedNeighbors=0,maxCellOccupancy=0,occupiedCells=0,sourceIndexJumpSum=0,sourceIndexJumps=0;
  for(let c=0;c<cellCount;c++){
    maxCellOccupancy=Math.max(maxCellOccupancy,counts[c]);if(counts[c])occupiedCells++;
    for(let k=offsets[c]+1;k<offsets[c+1];k++){sourceIndexJumpSum+=Math.abs(packed[k]-packed[k-1]);sourceIndexJumps++;}
  }
  const h2=h*h;
  for(let i=0;i<n;i++){
    const p=points[i],c=coordinates[i];let accepted=0;
    for(let z=Math.max(0,c[2]-searchRadius[2]);z<=Math.min(dims[2]-1,c[2]+searchRadius[2]);z++)
    for(let y=Math.max(0,c[1]-searchRadius[1]);y<=Math.min(dims[1]-1,c[1]+searchRadius[1]);y++)
    for(let x=Math.max(0,c[0]-searchRadius[0]);x<=Math.min(dims[0]-1,c[0]+searchRadius[0]);x++){
      visitedCells++;const cell=cellId(x,y,z);if(counts[cell])nonemptyCellsVisited++;
      let near2=0;const cc=[x,y,z];
      for(let a=0;a<3;a++){
        const pad=width[a]*.001;
        const lower=cc[a]===0?-Infinity:lo[a]+cc[a]*width[a]-pad;
        const upper=cc[a]===dims[a]-1?Infinity:lo[a]+(cc[a]+1)*width[a]+pad;
        near2+=Math.max(lower-p[a],0,p[a]-upper)**2;
      }
      const keep=near2<=h2;
      for(let k=offsets[cell];k<offsets[cell+1];k++){
        const j=packed[k];if(j===i)continue;candidates++;if(keep)prunedCandidates++;
        const q=points[j],d2=(p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2;
        if(d2<h2){accepted++;acceptedPairs++;if(keep)acceptedAfterCellRejection++;else throw Error('cell rejection lost a contributing pair');}
      }
    }
    maxAcceptedNeighbors=Math.max(maxAcceptedNeighbors,accepted);
  }
  return {gridDimensions:dims,cellWidth:width,searchRadius,particleCount:n,packedParticleCount:offsets[cellCount],packedOrderMatchesLinked,occupiedCells,maxCellOccupancy,visitedCells,nonemptyCellsVisited,candidates,prunedCandidates,acceptedPairs,acceptedAfterCellRejection,maxAcceptedNeighbors,meanCandidates:candidates/n,meanPrunedCandidates:prunedCandidates/n,meanAcceptedNeighbors:acceptedPairs/n,meanWithinCellSourceIndexJump:sourceIndexJumpSum/Math.max(1,sourceIndexJumps),memoryBytes:{linkedIndex:n*4+cellCount*4,packedIndex:n*4+(cellCount+1)*4,packedConstructionCountsAndCursors:cellCount*8,packedHotPositionAndId:n*16,neighborOffsets:(n+1)*4,neighborIds:acceptedPairs*4,neighborIdWeightGradient32:acceptedPairs*32}};
}
