export function validateReceiverSpacing(value){
  if(!Number.isFinite(value)||value<0)throw new Error('receiver spacing must be finite and nonnegative');return value;
}
// Exact per-vertex reference representation, retained as the zero-spacing mode.
export function surfaceReceiverLayout(vertices,triangles,{spacing=0,regions=[]}={}){
  validateReceiverSpacing(spacing);
  const count=vertices.length;
  if(regions.length&&regions.length!==count)throw new Error('receiver material regions must match vertices');
  for(const v of vertices)if(![v.position,v.normal].every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite))||Math.abs(Math.hypot(...v.normal)-1)>.0001)throw new Error('finite receiver positions and unit normals required');
  if(triangles.length%3||Array.from(triangles).some(i=>!Number.isInteger(i)||i<0||i>=count))throw new Error('surface receiver topology index invalid');
  const indices=new Float32Array(count*4),weights=new Float32Array(count*4);
  if(spacing===0){
    for(let i=0;i<count;i++){indices[i*4]=i;weights[i*4]=1;}
    return {receivers:vertices,indices,weights,triangles:Uint32Array.from(triangles),metadata:{identity:'vertex-reference-v1',spacing,vertices:count,receivers:count,normalBandStep:.25,stencilWidth:1}};
  }
  // Grouping is graph-local within a spatial cell and a small normal cone.
  // Quantized normal bands bound pairwise angular drift; chain unions cannot
  // walk from one receiving hemisphere into the opposite one.
  const parent=Uint32Array.from({length:count},(_,i)=>i),size=new Uint32Array(count).fill(1);
  const pointKeys=vertices.map(v=>v.position.map(Math.fround).join(','));
  const labels=vertices.map((v,i)=>JSON.stringify([v.normal.map(n=>Math.floor(n/.25+.5)),!!v.twoSided,regions[i]??'']));
  const cells=vertices.map((v,i)=>{const cell=v.position.map(x=>Math.floor(x/spacing));if(!cell.every(Number.isSafeInteger))throw new Error('receiver cell coordinate exceeds exact integer capacity');return JSON.stringify([cell,labels[i]]);});
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const union=(a,b)=>{if(cells[a]!==cells[b])return;let x=root(a),y=root(b);if(x===y)return;if(size[x]<size[y])[x,y]=[y,x];parent[y]=x;size[x]+=size[y];};
  const edges=new Map();let seamJoins=0;
  for(let t=0;t<triangles.length;t+=3)for(let e=0;e<3;e++){
    let a=triangles[t+e],b=triangles[t+(e+1)%3];union(a,b);
    // Only exact shared geometric edges reconnect split UV vertices. Point
    // contact and nearby disconnected sheets do not become graph neighbors.
    if(pointKeys[a]>pointKeys[b])[a,b]=[b,a];
    const key=JSON.stringify([pointKeys[a],pointKeys[b],labels[a],labels[b]]),previous=edges.get(key);
    if(previous){union(a,previous[0]);union(b,previous[1]);seamJoins++;}else edges.set(key,[a,b]);
  }
  const groups=new Map();
  for(let i=0;i<count;i++){const r=root(i);let g=groups.get(r);if(!g){g={members:[],sum:[0,0,0],id:groups.size};groups.set(r,g);}g.members.push(i);for(let a=0;a<3;a++)g.sum[a]+=vertices[i].position[a];}
  const vertexReceiver=new Uint32Array(count),receivers=[],representatives=[];
  let maxGroupRadius=0,maxGroupSize=0;
  for(const g of groups.values()){
    const center=g.sum.map(x=>x/g.members.length);let chosen=g.members[0],best=Infinity;
    for(const i of g.members){const d=vertices[i].position.reduce((s,x,a)=>s+(x-center[a])**2,0);if(d<best){chosen=i;best=d;}}
    receivers.push(vertices[chosen]);representatives.push(chosen);maxGroupSize=Math.max(maxGroupSize,g.members.length);
    for(const i of g.members){vertexReceiver[i]=g.id;maxGroupRadius=Math.max(maxGroupRadius,Math.hypot(...vertices[i].position.map((x,a)=>x-vertices[chosen].position[a])));}
  }
  const neighbors=Array.from({length:receivers.length},()=>new Set()),coarseTriangles=new Uint32Array(triangles.length);
  const regionMatches=(a,b)=>(regions[a]??'')===(regions[b]??'')&&!!vertices[a].twoSided===!!vertices[b].twoSided;
  for(let t=0;t<triangles.length;t+=3)for(let e=0;e<3;e++){
    const a=triangles[t+e],b=triangles[t+(e+1)%3],x=vertexReceiver[a],y=vertexReceiver[b];coarseTriangles[t+e]=x;
    if(x!==y&&regionMatches(a,b)&&vertices[a].normal.reduce((s,n,k)=>s+n*vertices[b].normal[k],0)>=.9){neighbors[x].add(y);neighbors[y].add(x);}
  }
  const candidateDistance=(i,id)=>vertices[i].position.reduce((s,x,a)=>s+(x-receivers[id].position[a])**2,0);
  let directedEdges=0;for(const n of neighbors)directedEdges+=n.size;
  for(let i=0;i<count;i++){
    const own=vertexReceiver[i],candidates=[own,...neighbors[own]].filter(id=>regionMatches(i,representatives[id])&&vertices[i].normal.reduce((s,x,a)=>s+x*receivers[id].normal[a],0)>=.9&&candidateDistance(i,id)<=6.25*spacing*spacing);
    // The own receiver's normal cone is guaranteed compatible. Preserve it
    // even if an isolated group has no interpolation neighborhood.
    if(!candidates.includes(own))candidates.unshift(own);
    const nearest=candidates.map(id=>({id,d:candidateDistance(i,id)})).sort((a,b)=>a.d-b.d||a.id-b.id);
    const exact=nearest.find(x=>x.d===0);
    if(exact){indices[i*4]=exact.id;weights[i*4]=1;continue;}
    const picked=[{id:own,d:candidateDistance(i,own)},...nearest.filter(x=>x.id!==own).slice(0,3)];
    const total=picked.reduce((s,x)=>s+1/x.d,0);
    for(let j=0;j<picked.length;j++){indices[i*4+j]=picked[j].id;weights[i*4+j]=(1/picked[j].d)/total;}
  }
  return {receivers,indices,weights,triangles:coarseTriangles,vertexReceiver,representatives:Uint32Array.from(representatives),metadata:{identity:'connected-cell-normal-band-v1',spacing,vertices:count,receivers:receivers.length,normalBandStep:.25,normalCosine:.9,stencilWidth:4,seamJoins,directedEdges,maxGroupRadius,maxGroupSize}};
}
export function interpolateReceiverValues(layout,values,channels=4){
  const out=new Float32Array(layout.weights.length/4*channels);
  for(let i=0;i<out.length/channels;i++)for(let j=0;j<4;j++)for(let c=0;c<channels;c++)out[i*channels+c]+=values[layout.indices[i*4+j]*channels+c]*layout.weights[i*4+j];
  return out;
}
