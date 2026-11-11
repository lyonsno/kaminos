// Static authored construction, not a fracture/erosion simulation. The carrier
// encloses the inward-relieved source. Face charts retain the pre-relief point.
const faces=[
 {n:[0,1,0],u:[1,0,0],v:[0,0,-1]},
 {n:[0,-1,0],u:[1,0,0],v:[0,0,1]},
 {n:[1,0,0],u:[0,0,-1],v:[0,1,0]},
 {n:[-1,0,0],u:[0,0,1],v:[0,1,0]},
 {n:[0,0,1],u:[1,0,0],v:[0,1,0]},
 {n:[0,0,-1],u:[-1,0,0],v:[0,1,0]},
];
export const masonryDefaults=Object.freeze({width:1.4,height:.28,depth:1,bevel:.04,margin:.13,relief:.025,cells:18,seed:41});

export function resolveMasonryConfig(options={}){
 const config={...masonryDefaults,...options};
 const {width,height,depth,bevel,margin,relief,cells,seed}=config;
 const half=[width/2,height/2,depth/2],minimum=Math.min(...half);
 if(![width,height,depth].every(x=>Number.isFinite(x)&&x>0)||![bevel,margin].every(x=>Number.isFinite(x)&&x>=0)||!Number.isFinite(relief)||relief<0||bevel>=minimum||relief>=minimum-bevel||!Number.isSafeInteger(cells)||cells<2||(!Number.isSafeInteger(seed)||seed<0))throw Error('Invalid masonry recipe: positive dimensions, nonnegative bevel and margin; inward relief must fit inside the carrier');
 return config;
}
export function createMasonrySource(options={}){
 const config=resolveMasonryConfig(options);
 const {width,height,depth,bevel,margin,relief,cells,seed}=config,half=[width/2,height/2,depth/2];
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const phase=Array.from({length:6},()=>random()*6.283185307);
 const distances=q=>q.map((x,i)=>half[i]-Math.abs(x)).sort((a,b)=>a-b);
 const shape=q=>{
  const center=q.map((x,i)=>Math.max(-half[i]+bevel,Math.min(half[i]-bevel,x)));
  const delta=q.map((x,i)=>x-center[i]),length=Math.hypot(...delta),normal=delta.map(x=>length?x/length:0);
  const carrier=center.map((x,i)=>x+normal[i]*bevel);
  const distance=distances(q)[1],edge=margin===0?0:Math.max(0,1-distance/margin);
  const [x,y,z]=q;
  const structure=.5+.21*Math.sin(19*x+13*y+11*z+phase[0])+.17*Math.sin(37*x-29*y+23*z+phase[1])+.12*Math.cos(71*x+41*y-53*z+phase[2]);
  const inset=relief*edge*edge*structure;
  // A positive radial contraction preserves triangle winding and stays inside
  // the convex carrier even when the authored dent exceeds the bevel radius.
  // Bevel-normal displacement instead folds through its center of curvature.
  const radius=Math.hypot(...carrier),factor=1-inset/radius;
  return {position:carrier.map(v=>v*factor),carrier};
 };
 const triangles=[],counts={face:0,margin:0,corner:0};
 for(let faceId=0;faceId<faces.length;faceId++){
  const f=faces[faceId],points=[];
  for(let j=0;j<=cells;j++)for(let i=0;i<=cells;i++){
   const u=(2*i-cells)/cells,v=(2*j-cells)/cells;
   const reference=f.n.map((n,k)=>(n+f.u[k]*u+f.v[k]*v)*half[k]).map(x=>x===0?0:x);
   points.push({reference,...shape(reference),uv:[i/cells,j/cells]});
  }
  const add=(ia,ib,ic)=>{
   const vertices=[points[ia],points[ib],points[ic]],center=vertices[0].reference.map((_,k)=>vertices.reduce((s,p)=>s+p.reference[k],0)/3);
   const d=distances(center),region=d[2]<=margin?'corner':d[1]<=margin?'margin':'face';counts[region]++;
   triangles.push({a:vertices[0].position,b:vertices[1].position,c:vertices[2].position,
    reference:{a:vertices[0].reference,b:vertices[1].reference,c:vertices[2].reference},
    carrier:{a:vertices[0].carrier,b:vertices[1].carrier,c:vertices[2].carrier},
    uv:vertices.map(p=>p.uv),faceId,region,materialIndex:region==='face'?0:region==='margin'?1:2,
    identity:`face-${faceId}-triangle-${triangles.length}`});
  };
  for(let j=0;j<cells;j++)for(let i=0;i<cells;i++){
   const a=j*(cells+1)+i,b=a+1,d=a+cells+1,c=d+1;add(a,b,c);add(a,c,d);
  }
 }
 return {schema:'kaminos.authored-masonry-source.v1',config,triangles,counts,
  materials:[{name:'dressed face',color:[.48,.43,.35],roughness:.88,metalness:0},{name:'relieved margin',color:[.41,.355,.28],roughness:.97,metalness:0},{name:'corner region',color:[.41,.355,.28],roughness:.97,metalness:0}],
  boundary:'finite closed authored stone; face charts preserve one common source position at their seams',
  representation:'explicit source geometry; no learned NVIDIA/SBTF response or simulated damage'};
}

// Small individual inspection queries against the actual source triangles.
// This is not a bulk transport/capture backend.
export function traceMasonryRay(source,{origin,direction,surface='source'}={}){
 if(![origin,direction].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||Math.hypot(...direction)===0||!['source','carrier'].includes(surface))throw Error('Invalid masonry ray');
 const length=Math.hypot(...direction),d=direction.map(x=>x/length);
 const sub=(a,b)=>a.map((x,i)=>x-b[i]);
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
 let closest=Infinity,result={hit:false};
 for(const triangle of source.triangles){
  const t=surface==='carrier'?triangle.carrier:triangle;
  const e1=sub(t.b,t.a),e2=sub(t.c,t.a),p=cross(d,e2),det=dot(e1,p);
  if(Math.abs(det)<1e-12)continue;
  const s=sub(origin,t.a),u=dot(s,p)/det;if(u<0||u>1)continue;
  const q=cross(s,e1),v=dot(d,q)/det;if(v<0||u+v>1)continue;
  const distance=dot(e2,q)/det;if(distance<1e-8||distance>=closest)continue;
  const weights=[1-u-v,u,v],n=cross(e1,e2),norm=Math.hypot(...n);
  const blend=values=>values[0].map((_,i)=>values.reduce((s,x,k)=>s+weights[k]*x[i],0));
  closest=distance;
  result={hit:true,surface,distance,position:origin.map((x,i)=>x+distance*d[i]),normal:n.map(x=>x/norm),
   uv:blend(triangle.uv),referencePosition:blend(['a','b','c'].map(k=>triangle.reference[k])),
   barycentric:weights,faceId:triangle.faceId,region:triangle.region,triangleId:triangle.identity};
 }
 return result;
}
