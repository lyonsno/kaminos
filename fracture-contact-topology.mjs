// The direct attachment and the connectivity of an initially neighboring pair
// are different facts. A broken direct interface can contact while the material
// remains connected elsewhere; a sampled path never stands in for connectivity.
export function contactTopology(cells,bonds){
 const adjacency=cells.map(()=>[]),direct=new Map();
 for(const [id,b]of bonds.entries()){
  if(!cells[b.a]||!cells[b.b]||b.a===b.b)throw Error('Contact topology requires distinct known material cells');
  adjacency[b.a].push([b.b,id]);adjacency[b.b].push([b.a,id]);
  const key=Math.min(b.a,b.b)+':'+Math.max(b.a,b.b);if(!direct.has(key))direct.set(key,[]);direct.get(key).push(id);
 }
 const pairs=[];
 for(let j=1;j<cells.length;j++)for(let i=0;i<j;i++){
  const a=cells[i],b=cells[j],overlap=Math.min(...a.position.map((x,k)=>a.halfExtents[k]+b.halfExtents[k]-Math.abs(x-b.position[k])));
  pairs.push({i,j,direct:direct.get(i+':'+j)??[],initialNeighbor:overlap>-.002});
 }
 return {adjacency,pairs};
}

// Offline truth oracle for native conformance checks. It is not called by the
// serving loop and does not acquire GPU state.
export function contactEligibility(topology,alive){
 const labels=topology.adjacency.map(()=>-1);
 for(let start=0;start<labels.length;start++)if(labels[start]<0){const queue=[start];labels[start]=start;
  for(let head=0;head<queue.length;head++)for(const [to,bond]of topology.adjacency[queue[head]])if(alive[bond]&&labels[to]<0){labels[to]=start;queue.push(to);}
 }
 return topology.pairs.map(p=>p.direct.length?!p.direct.some(b=>alive[b]):!p.initialNeighbor||labels[p.i]!==labels[p.j]);
}
