// Improve a surface-distance proposal before judging its attachment. The search
// holds an interior core and the distant exterior; only the intervening band
// can change ownership. Every source face retains its original geometry.
import {checkedFaces,faceKey} from './fracture-boundary-edit.mjs';
const graphs=new WeakMap();
function prepared(graph){
 if(graphs.has(graph))return graphs.get(graph);
 const neighbors=Array.from({length:graph.triangles.length},()=>[]);
 for(const e of graph.links){const [a,b]=e.faces,d=Math.hypot(...graph.triangles[a].center.map((v,k)=>v-graph.triangles[b].center[k]));neighbors[a].push([b,d,e.length]);neighbors[b].push([a,d,e.length]);}
 for(const [a,b]of graph.duplicates){neighbors[a].push([b,0,null]);neighbors[b].push([a,0,null]);}
 const value={neighbors,results:new Map()};graphs.set(graph,value);return value;
}
function boundaryDistances(neighbors,inside,faces,width){
 const d=new Float64Array(neighbors.length).fill(Infinity),heap=[],visited=[];
 const push=(f,w)=>{if(w>=width||w>=d[f])return;d[f]=w;let i=heap.length;heap.push([f,w]);while(i){const p=(i-1)>>1;if(heap[p][1]<=w)break;heap[i]=heap[p];i=p;}heap[i]=[f,w];};
 const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][1]<heap[c][1])c++;if(heap[c][1]>=last[1])break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
 for(const f of faces)for(const [g,w]of neighbors[f])if(!inside[g]){push(f,w/2);push(g,w/2);}
 while(heap.length){const [f,w]=pop();if(w!==d[f])continue;visited.push(f);for(const [g,l]of neighbors[f])if(inside[g]===inside[f])push(g,w+l);}
 return {distance:d,visited};
}
// Undirected minimum cut. Iterative augmenting paths avoid dependence on the
// JavaScript call stack when a long fitting produces a deep residual path.
export function minimumSurfaceCut(n,edges,source=0,sink=1){
 const g=Array.from({length:n},()=>[]);
 for(const [a,b,w]of edges){const x={to:b,c:w,rev:g[b].length},y={to:a,c:w,rev:g[a].length};g[a].push(x);g[b].push(y);}
 const level=new Int32Array(n),next=new Int32Array(n),queue=new Int32Array(n);let flow=0;
 const bfs=()=>{level.fill(-1);level[source]=0;queue[0]=source;let h=0,t=1;while(h<t){const a=queue[h++];for(const e of g[a])if(e.c>0&&level[e.to]<0){level[e.to]=level[a]+1;queue[t++]=e.to;}}return level[sink]>=0;};
 const send=()=>{const nodes=[source],path=[],capacity=[Infinity];while(nodes.length){const a=nodes.at(-1);if(a===sink){const amount=capacity.at(-1);for(let i=0;i<path.length;i++){const e=g[nodes[i]][path[i]];e.c=Math.max(0,e.c-amount);g[e.to][e.rev].c+=amount;}return amount;}
  let found=false;for(;next[a]<g[a].length;next[a]++){const e=g[a][next[a]];if(e.c>0&&level[e.to]===level[a]+1){nodes.push(e.to);path.push(next[a]);capacity.push(Math.min(capacity.at(-1),e.c));found=true;break;}}
  if(!found){level[a]=-1;nodes.pop();capacity.pop();path.pop();if(nodes.length)next[nodes.at(-1)]++;}
 }return 0;};
 while(bfs()){next.fill(0);let value;while((value=send())>0)flow+=value;}
 return {flow,inside:Uint8Array.from(level,v=>v>=0)};
}
export function refineAttachmentBoundary(graph,input,{reach}={}){
 if(!Number.isFinite(reach)||reach<=0)throw Error('Positive finite boundary-search reach required');
 const faces=checkedFaces(graph,input),{neighbors,results}=prepared(graph),key=faceKey(faces)+':'+reach;
 if(results.has(key))return results.get(key);
 const n=neighbors.length,inside=new Uint8Array(n);for(const f of faces)inside[f]=1;
 const measure=list=>{const mask=new Uint8Array(n);for(const f of list)mask[f]=1;let area=0,perimeter=0;for(const f of list){area+=graph.triangles[f].area;for(const [g,,w]of neighbors[f])if(!mask[g]&&w!==null)perimeter+=w;}return {area,perimeter,cutRatio:area?perimeter**2/area:Infinity};};
 const original=measure(faces),band=boundaryDistances(neighbors,inside,faces,reach*.5),coreMask=new Uint8Array(n);
 for(const f of faces)if(band.distance[f]===Infinity)coreMask[f]=1;
 let core=[],coreArea=-1;const seen=new Uint8Array(n);
 for(const start of faces){if(!coreMask[start]||seen[start])continue;const group=[],stack=[start];seen[start]=1;let area=0;while(stack.length){const f=stack.pop();group.push(f);area+=graph.triangles[f].area;for(const [g]of neighbors[f])if(coreMask[g]&&!seen[g]){seen[g]=1;stack.push(g);}}if(area>coreArea){core=group;coreArea=area;}}
 const unchanged=reason=>{const value={faces,...original,originalPerimeter:original.perimeter,reason};results.set(key,value);return value;};
 if(!core.length||!original.perimeter)return unchanged('no-interior-core-or-interface');
 const labels=new Int32Array(n).fill(1),local=[...faces,...band.visited.filter(f=>!inside[f])];let count=2;
 for(const f of local)labels[f]=count++;for(const f of core)labels[f]=0;
 const edges=[],duplicates=[];let sum=0;
 for(const f of local)for(const [g,,w]of neighbors[f]){const a=labels[f],b=labels[g];if(a===b||g<f&&b!==1)continue;if(w===null)duplicates.push([a,b]);else{edges.push([a,b,w]);sum+=w;}}
 for(const [a,b]of duplicates)edges.push([a,b,sum+1]);
 const solution=minimumSurfaceCut(count,edges),retained=new Uint8Array(n),stack=[core[0]];retained[core[0]]=1;
 while(stack.length){const f=stack.pop();for(const [g]of neighbors[f])if(!retained[g]&&solution.inside[labels[g]]){retained[g]=1;stack.push(g);}}
 const selected=local.filter(f=>retained[f]).sort((a,b)=>a-b),metric=measure(selected);
 if(metric.perimeter>=original.perimeter)return unchanged('no-shorter-boundary');
 const result={faces:selected,...metric,originalPerimeter:original.perimeter,reason:'shorter-boundary'};results.set(key,result);return result;
}
