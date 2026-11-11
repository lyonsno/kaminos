// Quasistatic periodic triangular sheet. Finite metric strain and dihedral
// bending are invariant to rigid rotations. Contact is nodal against the
// piecewise-linear oxide surface; self-contact and film fracture are absent.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const scale=(a,k)=>a.map(v=>v*k),add=(a,b)=>a.map((v,i)=>v+b[i]);
export function periodicSheetTopology(n,opening){
 const faces=[],edges=new Map(),index=(x,z)=>(z%n)*n+x%n;
 for(let z=0;z<n;z++)for(let x=0;x<n;x++)if(!opening[z*n+x]){
  const q=[[x,z],[x,z+1],[x+1,z+1],[x+1,z]],cell=z*n+x;
  for(const ids of[[0,1,2],[0,2,3]]){
   const rest=ids.map(i=>[q[i][0]/n,0,q[i][1]/n]),vertices=ids.map(i=>index(...q[i])),a=rest[1][0]-rest[0][0],b=rest[2][0]-rest[0][0],c=rest[1][2]-rest[0][2],d=rest[2][2]-rest[0][2],det=a*d-b*c;
   const face={vertices,rest,area:Math.abs(det)/2,inverse:[d/det,-b/det,-c/det,a/det],cell},fi=faces.length;faces.push(face);
   for(let i=0;i<3;i++){const j=(i+1)%3,key=[vertices[i],vertices[j]].sort((a,b)=>a-b).join(':');const e=edges.get(key);if(e)e.faces.push(fi);else edges.set(key,{faces:[fi],length:Math.hypot(...sub(rest[i],rest[j]))});}
  }
 }
 return {n,faces,hinges:[...edges.values()].filter(e=>e.faces.length===2).map(e=>({...e,weight:e.length**2/(faces[e.faces[0]].area+faces[e.faces[1]].area)}))};
}
export function sheetElasticEnergy(topology,u,{stretching,bending,poisson=.3}){
 const g=new Float64Array(u.length),normals=[],crosses=[],points=[];let energy=0;
 const mu=stretching/(2*(1+poisson)),lambda=stretching*poisson/(1-poisson**2);
 const push=(face,k,v)=>{const i=face.vertices[k]*3;for(let j=0;j<3;j++)g[i+j]+=v[j];};
 for(const face of topology.faces){
  const p=face.rest.map((r,k)=>r.map((v,j)=>v+u[face.vertices[k]*3+j])),e1=sub(p[1],p[0]),e2=sub(p[2],p[0]),normal=cross(e1,e2),length=Math.hypot(...normal);
  if(!(length>face.area*1e-12))return {energy:Infinity,gradient:g};
  points.push(p);crosses.push(length);normals.push(scale(normal,1/length));
  const [a,b,c,d]=face.inverse,F0=add(scale(e1,a),scale(e2,c)),F1=add(scale(e1,b),scale(e2,d)),E00=(dot(F0,F0)-1)/2,E11=(dot(F1,F1)-1)/2,E01=dot(F0,F1)/2,tr=E00+E11;
  energy+=face.area*(mu*(E00**2+E11**2+2*E01**2)+lambda/2*tr**2);
  const P0=add(scale(F0,2*mu*E00+lambda*tr),scale(F1,2*mu*E01)),P1=add(scale(F0,2*mu*E01),scale(F1,2*mu*E11+lambda*tr));
  const g1=scale(add(scale(P0,a),scale(P1,b)),face.area),g2=scale(add(scale(P0,c),scale(P1,d)),face.area);push(face,1,g1);push(face,2,g2);push(face,0,scale(add(g1,g2),-1));
 }
 for(const hinge of topology.hinges){
  const [i,j]=hinge.faces,ni=normals[i],nj=normals[j],cos=Math.max(-1,Math.min(1,dot(ni,nj))),sin=Math.hypot(...cross(ni,nj)),theta=Math.atan2(sin,cos),k=bending*hinge.weight;
  if(cos<0&&sin<1e-12)return {energy:Infinity,gradient:g};
  energy+=.5*k*theta**2;const ratio=theta<1e-6?1:theta/sin;
  for(const [f,n,other]of[[i,ni,nj],[j,nj,ni]]){
   const face=topology.faces[f],gn=scale(other,-k*ratio),gc=scale(sub(gn,scale(n,dot(n,gn))),1/crosses[f]),e1=sub(points[f][1],points[f][0]),e2=sub(points[f][2],points[f][0]),g1=cross(e2,gc),g2=cross(gc,e1);push(face,1,g1);push(face,2,g2);push(face,0,scale(add(g1,g2),-1));
  }
 }
 return {energy,gradient:g};
}
// Limited-memory BFGS stores optimizer curvature pairs, not a restriction on
// physical state or iteration count. A residual/no-progress condition closes it.
function minimize(initial,evaluate,tolerance){
 let x=initial.slice(),current=evaluate(x),history=[],iterations=0;
 if(!Number.isFinite(current.energy))throw Error('Invalid initial finite sheet geometry');
 for(;;){
  let maximum=0;for(const v of current.gradient)maximum=Math.max(maximum,Math.abs(v));if(maximum<=tolerance)return {x,iterations,residual:maximum};
  let q=current.gradient.slice(),alphas=[];
  for(let i=history.length-1;i>=0;i--){const h=history[i],a=h.rho*dot(h.s,q);alphas[i]=a;for(let j=0;j<q.length;j++)q[j]-=a*h.y[j];}
  const last=history.at(-1),factor=last?dot(last.s,last.y)/dot(last.y,last.y):1;let direction=Float64Array.from(q,v=>v*factor);
  for(let i=0;i<history.length;i++){const h=history[i],b=h.rho*dot(h.y,direction);for(let j=0;j<q.length;j++)direction[j]+=h.s[j]*(alphas[i]-b);}
  direction=Float64Array.from(direction,v=>-v);let slope=dot(current.gradient,direction);
  if(!(slope<0)){history=[];direction=Float64Array.from(current.gradient,v=>-v);slope=-dot(current.gradient,current.gradient);}
  let step=1,next,candidate;
  for(;;){candidate=Float64Array.from(x,(v,i)=>v+step*direction[i]);if(candidate.every((v,i)=>v===x[i]))throw Error(`Finite sheet line search cannot progress; residual ${maximum}`);next=evaluate(candidate);if(Number.isFinite(next.energy)&&next.energy<=current.energy+1e-4*step*slope)break;step*=.5;}
  const s=Float64Array.from(candidate,(v,i)=>v-x[i]),y=Float64Array.from(next.gradient,(v,i)=>v-current.gradient[i]),sy=dot(s,y);
  if(sy>1e-14*Math.sqrt(dot(s,s)*dot(y,y))){history.push({s,y,rho:1/sy});if(history.length>8)history.shift();}
  x=candidate;current=next;iterations++;
 }
}
const index=(n,x,z)=>((z%n+n)%n)*n+(x%n+n)%n;
export function coatingCorner(field,n,x,z){return [index(n,x,z),index(n,x-1,z),index(n,x,z-1),index(n,x-1,z-1)].reduce((s,i)=>s+field[i],0)/4;}
function heightSample(corners,n,x,z){
 x=(x-Math.floor(x))*n;z=(z-Math.floor(z))*n;const ix=Math.floor(x),iz=Math.floor(z),a=x-ix,b=z-iz,h00=corners[index(n,ix,iz)],h01=corners[index(n,ix,iz+1)],h11=corners[index(n,ix+1,iz+1)],h10=corners[index(n,ix+1,iz)];
 return b>=a?{height:(1-b)*h00+(b-a)*h01+a*h11,dx:n*(h11-h01),dz:n*(h01-h00)}:{height:(1-a)*h00+b*h11+(a-b)*h10,dx:n*(h10-h00),dz:n*(h11-h10)};
}
export function relaxFiniteCoating(s){
 const c=s.config,n=c.resolution,topology=periodicSheetTopology(n,s.opening),count=n*n,area=1/count;
 const steel=new Float64Array(count),oxide=new Float64Array(count),weights=new Float64Array(count),bondWeights=new Float64Array(count),multipliers=new Float64Array(count);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x;steel[i]=-c.metalScale*coatingCorner(s.metalLoss,n,x,z);oxide[i]=steel[i]+c.metalScale*c.oxideExpansion*coatingCorner(s.rustIron,n,x,z)/(1-c.oxidePorosity);}
 for(const face of topology.faces)for(const i of face.vertices)weights[i]+=face.area/3;
 let u=s.filmDisplacement,penalty=c.attachmentStiffness*10,totalIterations=0,contactResidual=Infinity,failed;
 do{
  bondWeights.fill(0);for(const face of topology.faces)for(const i of face.vertices)bondWeights[i]+=s.bond[face.cell]*face.area/3;
  for(;;){
   const evaluate=u=>{const result=sheetElasticEnergy(topology,u,{stretching:c.sheetStretching,bending:c.plateBending,poisson:c.sheetPoisson}),g=result.gradient;if(!Number.isFinite(result.energy))return result;
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){
     const i=z*n+x,j=i*3;if(!weights[i])continue;const dy=u[j+1]-steel[i],k=c.attachmentStiffness*bondWeights[i];result.energy+=.5*k*(u[j]**2+dy**2+u[j+2]**2);g[j]+=k*u[j];g[j+1]+=k*dy;g[j+2]+=k*u[j+2];
     const h=heightSample(oxide,n,x/n+u[j],z/n+u[j+2]),gap=h.height-u[j+1],force=Math.max(0,multipliers[i]+penalty*gap);result.energy+=weights[i]*(force**2-multipliers[i]**2)/(2*penalty);g[j]+=weights[i]*force*h.dx;g[j+1]-=weights[i]*force;g[j+2]+=weights[i]*force*h.dz;
    }return result;
   };
   const solved=minimize(u,evaluate,c.mechanicalTolerance*area);u=solved.x;totalIterations+=solved.iterations;contactResidual=0;
   for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x,j=i*3;if(!weights[i])continue;const gap=heightSample(oxide,n,x/n+u[j],z/n+u[j+2]).height-u[j+1];multipliers[i]=Math.max(0,multipliers[i]+penalty*gap);contactResidual=Math.max(contactResidual,Math.max(0,gap),multipliers[i]>0?Math.abs(gap):0);}
   if(contactResidual<=c.mechanicalTolerance)break;penalty*=2;if(!Number.isFinite(penalty))throw Error('Finite coating contact cannot converge');
  }
  failed=0;
  const attachmentEnergy=new Float64Array(count);
  for(const face of topology.faces)if(s.bond[face.cell])for(const j of face.vertices)attachmentEnergy[face.cell]+=.5*c.attachmentStiffness*(u[j*3]**2+(u[j*3+1]-steel[j])**2+u[j*3+2]**2)*face.area/(3*area);
  for(let i=0;i<count;i++)if(s.bond[i]&&!s.opening[i]&&attachmentEnergy[i]>s.toughness[i]){s.bond[i]=0;failed++;}
 }while(failed);
 s.filmDisplacement.set(u);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x;s.filmHeight[i]=c.filmThickness+[index(n,x,z),index(n,x,z+1),index(n,x+1,z+1),index(n,x+1,z)].reduce((sum,j)=>sum+u[j*3+1],0)/4;}
 s.mechanicalSolves++;s.sheetSolve={iterations:totalIterations,contactResidual,model:'finite metric membrane / dihedral bending / irreversible cohesive attachment / nodal oxide contact'};
}
