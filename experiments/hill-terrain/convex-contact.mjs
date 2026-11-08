// Separating-axis contact of two closed convex volumes. Features are retained
// independently of render triangulation; edge cross products cover edge cases.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rotate=(q,v)=>{const t=cross(q.slice(0,3),v).map(v=>v*2),u=cross(q.slice(0,3),t);return v.map((x,i)=>x+q[3]*t[i]+u[i]);};
const unit=v=>{const l=Math.hypot(...v);return l>1e-9?v.map(x=>x/l):null;};
const directions=list=>{const out=[];for(const v of list){const n=unit(v);if(n&&!out.some(q=>Math.abs(dot(n,q))>1-1e-8))out.push(n);}return out;};
export function convexFeatures(solid){
 const vertices=[],edges=[];
 for(const face of solid.faces){for(let i=0;i<face.vertices.length;i++){const p=face.vertices[i],q=face.vertices[(i+1)%face.vertices.length];if(!vertices.some(q=>Math.hypot(...p.map((v,k)=>v-q[k]))<1e-7))vertices.push(p);edges.push(q.map((v,k)=>v-p[k]));}}
 return{vertices,edges:directions(edges),normals:directions(solid.planes.map(p=>p.slice(0,3)))};
}
export function convexContact(a,b){
 const fa=a.features??convexFeatures(a.solid),fb=b.features??convexFeatures(b.solid),world=(body,feature)=>feature.vertices.map(v=>rotate(body.rotation,v).map((x,k)=>x+body.position[k]));
 const va=world(a,fa),vb=world(b,fb),ea=fa.edges.map(v=>rotate(a.rotation,v)),eb=fb.edges.map(v=>rotate(b.rotation,v));
 const axes=[...fa.normals.map(n=>rotate(a.rotation,n)),...fb.normals.map(n=>rotate(b.rotation,n)),...ea.flatMap(x=>eb.map(y=>cross(x,y)))];
 let depth=Infinity,normal;
 for(const candidate of axes){const axis=unit(candidate);if(!axis)continue;const pa=va.map(v=>dot(v,axis)),pb=vb.map(v=>dot(v,axis));const left=Math.max(...pa)-Math.min(...pb),right=Math.max(...pb)-Math.min(...pa);
  if(left<=0||right<=0)return null;const d=Math.min(left,right);if(d<depth){depth=d;normal=axis.map(v=>v*(left<right?-1:1));}
 }
 return{depth,normal};
}
export function conditionRockPoses(bodies){
 const shifts=[];
 for(let i=0;i<bodies.length;i++){
  const b=bodies[i],start=b.position[1];b.features=convexFeatures(b.solid);
  // Upward preparation has a finite geometric bound: above every predecessor
  // all bounded solids are disjoint. No material or source faces are removed.
  for(;;){let lift=0;for(let j=0;j<i;j++){const other=bodies[j],c=convexContact(b,other);if(!c||c.depth<1e-7)continue;
    if(c.normal[1]>.001)lift=Math.max(lift,(c.depth+1e-6)/c.normal[1]);
    else{const maxY=Math.max(...other.features.vertices.map(v=>rotate(other.rotation,v)[1]+other.position[1]));const minY=Math.min(...b.features.vertices.map(v=>rotate(b.rotation,v)[1]+b.position[1]));lift=Math.max(lift,maxY-minY+1e-6);}
   }if(lift<=0)break;b.position[1]+=lift;
  }shifts.push(b.position[1]-start);
 }
 return{kind:'upward nonpenetration preparation',verticalShifts:shifts,maxShift:Math.max(...shifts)};
}

// Highest vertical sweep boundary: place a source volume just above its
// support without overlap or an arbitrary air gap. Initial construction only.
export function verticalContactHeight(body,support){
 const a=convexFeatures(body.solid),b=convexFeatures(support.solid),world=(o,f)=>f.vertices.map(p=>rotate(o.rotation,p).map((v,k)=>v+o.position[k]));
 const A=world(body,a),B=world(support,b),ea=a.edges.map(p=>rotate(body.rotation,p)),eb=b.edges.map(p=>rotate(support.rotation,p));
 const axes=[...a.normals.map(n=>rotate(body.rotation,n)),...b.normals.map(n=>rotate(support.rotation,n)),...ea.flatMap(x=>eb.map(y=>cross(x,y)))];let enter=-Infinity,exit=Infinity;
 for(const candidate of axes){const n=unit(candidate);if(!n)continue;const pa=A.map(p=>dot(p,n)),pb=B.map(p=>dot(p,n)),alo=Math.min(...pa),ahi=Math.max(...pa),blo=Math.min(...pb),bhi=Math.max(...pb);
  if(Math.abs(n[1])<1e-9){if(ahi<=blo||bhi<=alo)throw Error('Source volumes have no vertical support intersection');continue;}
  const t0=(blo-ahi)/n[1],t1=(bhi-alo)/n[1];enter=Math.max(enter,Math.min(t0,t1));exit=Math.min(exit,Math.max(t0,t1));
 }
 if(!Number.isFinite(exit)||enter>exit)throw Error('Source volumes have no vertical support intersection');return body.position[1]+exit;
}
