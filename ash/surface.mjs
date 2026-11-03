// Exposed boundary only, partitioned by the deposit's dirty blocks. Vertices
// remain in cell coordinates; the consumer applies the same mapping as collision.
export function ashBlockSurface(deposit, blockId) {
 const positions=[],normals=[];
 const face=(corners,normal)=>{for(const i of [0,1,2,0,2,3]){positions.push(...corners[i]);normals.push(...normal);}};
 for(const [x,y,z,h] of deposit.blocks.get(blockId)?.values()??[]){
  const covered=p=>deposit.solid(p)?1:deposit.amount(p);
  const top=y+h;
  if(h<1||!covered([x,y+1,z]))face([[x,top,z],[x,top,z+1],[x+1,top,z+1],[x+1,top,z]],[0,1,0]);
  if(covered([x,y-1,z])<1)face([[x,y,z],[x+1,y,z],[x+1,y,z+1],[x,y,z+1]],[0,-1,0]);
  let low=y+covered([x-1,y,z]);if(low<top)face([[x,low,z],[x,low,z+1],[x,top,z+1],[x,top,z]],[-1,0,0]);
  low=y+covered([x+1,y,z]);if(low<top)face([[x+1,low,z+1],[x+1,low,z],[x+1,top,z],[x+1,top,z+1]],[1,0,0]);
  low=y+covered([x,y,z-1]);if(low<top)face([[x+1,low,z],[x,low,z],[x,top,z],[x+1,top,z]],[0,0,-1]);
  low=y+covered([x,y,z+1]);if(low<top)face([[x,low,z+1],[x+1,low,z+1],[x+1,top,z+1],[x,top,z+1]],[0,0,1]);
 }
 return {positions:new Float32Array(positions),normals:new Float32Array(normals)};
}
