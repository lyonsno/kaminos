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
// Packed adjacency preserves incident-edge order and float64 residuals without
// allocating an object for every directed edge.
export function minimumSurfaceCut(n,edges,source=0,sink=1){
 const offsets=new Uint32Array(n+1);for(const [a,b]of edges){offsets[a+1]++;offsets[b+1]++;}for(let i=1;i<=n;i++)offsets[i]+=offsets[i-1];
 const cursor=offsets.slice(0,n),to=new Uint32Array(edges.length*2),reverse=new Uint32Array(edges.length*2),residual=new Float64Array(edges.length*2);
 for(const [a,b,w]of edges){const x=cursor[a]++,y=cursor[b]++;to[x]=b;to[y]=a;reverse[x]=y;reverse[y]=x;residual[x]=residual[y]=w;}
 const level=new Int32Array(n),next=new Uint32Array(n),queue=new Uint32Array(n);let flow=0;
 const bfs=()=>{level.fill(-1);level[source]=0;queue[0]=source;let h=0,t=1;while(h<t){const a=queue[h++];for(let e=offsets[a];e<offsets[a+1];e++)if(residual[e]>0&&level[to[e]]<0){level[to[e]]=level[a]+1;queue[t++]=to[e];}}return level[sink]>=0;};
 const nodes=new Uint32Array(n),path=new Uint32Array(n),capacity=new Float64Array(n);
 const send=()=>{let depth=0;nodes[0]=source;capacity[0]=Infinity;while(depth>=0){const a=nodes[depth];if(a===sink){const amount=capacity[depth];for(let i=0;i<depth;i++){const e=path[i];residual[e]=Math.max(0,residual[e]-amount);residual[reverse[e]]+=amount;}return amount;}
  let found=false;for(;next[a]<offsets[a+1];next[a]++){const e=next[a],b=to[e];if(residual[e]>0&&level[b]===level[a]+1){path[depth]=e;capacity[depth+1]=Math.min(capacity[depth],residual[e]);nodes[++depth]=b;found=true;break;}}
  if(!found){level[a]=-1;depth--;if(depth>=0)next[nodes[depth]]++;}
 }return 0;};
 while(bfs()){next.set(offsets.subarray(0,n));let value;while((value=send())>0)flow+=value;}
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
