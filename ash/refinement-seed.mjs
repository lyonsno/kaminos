import {refinementIndex,refinementCell} from './refinement-plan.mjs';

// Explicit loading, not a serving simulation pass. Each finest-area column
// contributes its added volume once; coarse owners gather those contributions.
export function seedRefinedLayer(p, solid, {blanketDepth,groundOnly=false}, previous) {
  if(!Number.isFinite(blanketDepth)||blanketDepth<=0)throw Error('Invalid blanket depth');
  if(solid.length!==p.count||previous.length!==p.count)throw Error('Patch shape mismatch');
  if(p.hierarchy)return seedHierarchyLayer(p,solid,{blanketDepth,groundOnly},previous);
  const added=new Float64Array(p.count),depth=blanketDepth/p.cellSize;
  for(let z=0;z<p.dims[2];z++)for(let x=0;x<p.dims[0];x++){
    let y=0;
    while(y<p.dims[1]){
      let i=refinementIndex(p,[x,y,z]),c=refinementCell(p,i);
      if(solid[i]){y=c.coord[1]+c.size;continue;}
      const start=y,cells=[];
      while(y<p.dims[1]){
        i=refinementIndex(p,[x,y,z]);c=refinementCell(p,i);
        if(solid[i])break;
        cells.push({i,c});y=c.coord[1]+c.size;
      }
      const end=y;
      if(groundOnly&&start!==0)continue;
      let top=start;
      for(const {i,c}of cells)if(previous[i]>0)top=Math.max(top,c.coord[1]+previous[i]/(c.size*c.size));
      const high=Math.min(end,top+depth);
      for(const {i,c}of cells){
        if(c.coord[1]+c.size<=top||c.coord[1]>=high)continue;
        const desired=Math.min(c.size,high-c.coord[1]);
        added[i]+=Math.max(0,desired-previous[i]/(c.size*c.size));
      }
    }
  }
  return Float32Array.from(previous,(mass,i)=>mass+added[i]);
}

// Explicit initialization visits actual leaf cells, never every hypothetical
// finest-area column of the whole world. Existing fill heights remain physical.
function seedHierarchyLayer(p,solid,{blanketDepth,groundOnly},previous){
 const depth=blanketDepth/p.cellSize,columns=new Map(),out=previous.slice();
 for(let i=0;i<p.count;i++){
  const c=refinementCell(p,i);if(!c.owned||solid[i])continue;
  const x=c.coord[0]+c.size*.5,z=c.coord[2]+c.size*.5,key=x+','+z;
  let segments=columns.get(key);
  if(!segments){
   segments=[];let y=0;
   while(y<p.dims[1]){
    let j=refinementIndex(p,[x,y,z]),n=refinementCell(p,j);
    if(solid[j]){y=n.coord[1]+n.size;continue;}
    const start=y;let top=start;
    while(y<p.dims[1]){
     j=refinementIndex(p,[x,y,z]);n=refinementCell(p,j);if(solid[j])break;
     if(previous[j]>0)top=Math.max(top,n.coord[1]+previous[j]/n.size**2);
     y=n.coord[1]+n.size;
    }
    if(!groundOnly||start===0)segments.push({low:start,high:y,top:Math.min(y,top+depth)});
   }
   columns.set(key,segments);
  }
  const s=segments.find(n=>c.coord[1]>=n.low&&c.coord[1]<n.high);
  if(s)out[i]=Math.max(previous[i],Math.min(c.size,Math.max(0,s.top-c.coord[1]))*c.size**2);
 }
 return out;
}
