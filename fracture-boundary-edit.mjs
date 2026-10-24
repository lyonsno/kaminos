// Local surface-boundary motion. Distances follow the source triangle graph;
// they do not move vertices or infer solid material.
const cache=new WeakMap();
export function checkedFaces(graph,faces){
 if(!Array.isArray(faces)&&!ArrayBuffer.isView(faces))throw Error('Source face list required');
 const out=Array.from(faces).sort((a,b)=>a-b);
 if(!out.length||out.some((f,i)=>!Number.isInteger(f)||f<0||f>=graph.triangles.length||i&&f===out[i-1]))throw Error('Unique valid source faces required');
 return out;
}
export function faceKey(faces){
 let a=2166136261,b=2246822519;
 for(const f of faces){a=Math.imul(a^f,16777619)>>>0;b=Math.imul(b^f,3266489917)>>>0;}
 return `surface:${faces.length}:${a.toString(16)}:${b.toString(16)}`;
}
function distances(neighbors,inside,allowed,seeds){
 const d=new Float64Array(neighbors.length).fill(Infinity),heap=[];
 const push=(f,w)=>{let i=heap.length;heap.push([f,w]);while(i){const p=(i-1)>>1;if(heap[p][1]<=w)break;heap[i]=heap[p];i=p;}heap[i]=[f,w];};
 const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][1]<heap[c][1])c++;if(heap[c][1]>=last[1])break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
 for(const [f,w]of seeds)if(w<d[f]){d[f]=w;push(f,w);}
 while(heap.length){const [f,w]=pop();if(w!==d[f])continue;for(const [g,l]of neighbors[f])if(allowed[g]&&inside[g]===inside[f]&&w+l<d[g]){d[g]=w+l;push(g,d[g]);}}
 return d;
}
export function moveShapeBoundary(graph,anchor,offsetFraction){
 if(!Number.isFinite(offsetFraction))throw Error('Finite boundary position required');
 const faces=checkedFaces(graph,anchor.faces),allowedFaces=checkedFaces(graph,anchor.allowedFaces),protectedFaces=anchor.protectedFaces?.length?checkedFaces(graph,anchor.protectedFaces):[];
 const signature=JSON.stringify([faces,allowedFaces,protectedFaces]);let entry=cache.get(graph);
 if(!entry||entry.signature!==signature){
  const n=graph.triangles.length,inside=new Uint8Array(n),allowed=new Uint8Array(n),neighbors=Array.from({length:n},()=>[]);
  for(const f of allowedFaces)allowed[f]=1;for(const f of faces){if(!allowed[f])throw Error('Boundary source must be inside its allowed neighborhood');inside[f]=1;}
  for(const f of protectedFaces)if(!inside[f])throw Error('Protected child must be inside the attachment');
  for(const e of graph.links){const [a,b]=e.faces,w=Math.hypot(...graph.triangles[a].center.map((v,k)=>v-graph.triangles[b].center[k]));neighbors[a].push([b,w]);neighbors[b].push([a,w]);}
  for(const [a,b]of graph.duplicates){neighbors[a].push([b,0]);neighbors[b].push([a,0]);}
  const seeds=[];for(const f of allowedFaces)for(const [g,w]of neighbors[f])if(allowed[g]&&inside[f]!==inside[g])seeds.push([f,w/2]);
  if(!seeds.length)throw Error('This piece has no movable attachment boundary');
  const distance=distances(neighbors,inside,allowed,seeds),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const p of graph.vertices)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
  const diagonal=Math.hypot(...hi.map((v,k)=>v-lo[k]));
  let inward=0,outward=0;for(const f of allowedFaces)if(Number.isFinite(distance[f])){if(inside[f])inward=Math.max(inward,distance[f]);else outward=Math.max(outward,distance[f]);}
  for(const f of protectedFaces)inward=Math.min(inward,distance[f]);
  entry={signature,inside,allowedFaces,neighbors,distance,diagonal,min:-inward/diagonal,max:outward/diagonal};cache.set(graph,entry);
 }
 const {inside,neighbors,distance,diagonal,min,max}=entry,position=Math.max(min,Math.min(max,offsetFraction)),amount=position*diagonal;
 const moved=position===0?faces:allowedFaces.filter(f=>inside[f]?position>=0||distance[f]>=-amount:position>0&&distance[f]<amount);
 // A boundary may move only while the selected surface stays connected.
 const mask=new Uint8Array(graph.triangles.length);for(const f of moved)mask[f]=1;
 const seen=new Set([moved[0]]),stack=[moved[0]];while(stack.length){const f=stack.pop();for(const [g]of neighbors[f])if(mask[g]&&!seen.has(g)){seen.add(g);stack.push(g);}}
 if(!moved.length||seen.size!==moved.length)throw Error('This position disconnects the fitting; the previous cut is retained');
 return {faces:moved,offsetFraction:position,requestedOffsetFraction:offsetFraction,limits:{min,max},limited:position!==offsetFraction};
}

export function boundaryAnchor(result,key,baselineFaces,{protectedKeys=null}={}){
 const node=result.hierarchy.nodes.find(n=>n.key===key);if(!node||node.kind!=='branch')throw Error('Select an attachment branch to move its cut');
 const chosen=result.candidateBranches.find(c=>c.key===key&&c.status==='included');
 const faces=Array.from(baselineFaces??chosen.faces),inside=new Set(faces),parent=node.parent;
 const under=(id,ancestor)=>{while(id!==null){if(id===ancestor)return true;id=result.hierarchy.nodes[id].parent;}return false;};
 const allowedFaces=[],protectedFaces=[];
 for(let f=0;f<result.triangleCount;f++){
  const owner=result.hierarchy.faceOwners[f];if(!under(owner,parent))continue;
  let branch=owner;while(result.hierarchy.nodes[branch].kind==='patch')branch=result.hierarchy.nodes[branch].parent;
  if(branch===parent||under(branch,node.id))allowedFaces.push(f);
  if(branch!==node.id&&under(branch,node.id)&&result.hierarchy.nodes[branch].kind==='branch'){let p=branch,protect=protectedKeys===null;while(p!==node.id){if(protectedKeys?.includes(result.hierarchy.nodes[p].key))protect=true;p=result.hierarchy.nodes[p].parent;}if(protect)protectedFaces.push(f);}
 }
 // Restoring or moving from the original boundary must remain possible after
 // a previous shrink; the current parent still owns that released surface.
 const allowedSet=new Set(allowedFaces);for(const f of faces)if(!allowedSet.has(f))throw Error('An existing neighboring cut blocks this alternative');
 for(const f of protectedFaces)if(!inside.has(f))throw Error('This alternative crosses an existing child cut');
 return {faces,allowedFaces,protectedFaces};
}
