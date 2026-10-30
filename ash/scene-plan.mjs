// Tile addresses for a world-space affected region; the region admits work,
// never substitutes for the object's actual triangle-derived collision shape.
export function sceneTiles(p,box){
 if(!box||box.max.some((v,k)=>v<p.origin[k])||box.min.some((v,k)=>v>=p.origin[k]+p.dims[k]*p.cellSize))return [];
 const size=p.tiles.width*p.cellSize,lo=box.min.map((v,k)=>Math.max(0,Math.floor((v-p.origin[k])/size))),hi=box.max.map((v,k)=>Math.min(p.tiles.dims[k]-1,Math.floor((v-p.origin[k])/size))),out=[];
 for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)out.push(x+p.tiles.dims[0]*(y+p.tiles.dims[1]*z));
 return out;
}
