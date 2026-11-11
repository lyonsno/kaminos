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
export function minimizeSheetEnergy(initial,evaluate,tolerance,onAcceptedStep=()=>{},breakpoint=()=>null){
 let x=initial.slice(),current=evaluate(x),history=[],iterations=0,creaseProjections=0;
 if(!Number.isFinite(current.energy))throw Error('Invalid initial finite sheet geometry');
 for(;;){
  let maximum=0;for(const v of current.gradient)maximum=Math.max(maximum,Math.abs(v));if(maximum<=tolerance)return {x,iterations,creaseProjections,residual:maximum};
  let q=current.gradient.slice(),alphas=[];
  for(let i=history.length-1;i>=0;i--){const h=history[i],a=h.rho*dot(h.s,q);alphas[i]=a;for(let j=0;j<q.length;j++)q[j]-=a*h.y[j];}
  const last=history.at(-1),factor=last?dot(last.s,last.y)/dot(last.y,last.y):1;let direction=Float64Array.from(q,v=>v*factor);
  for(let i=0;i<history.length;i++){const h=history[i],b=h.rho*dot(h.y,direction);for(let j=0;j<q.length;j++)direction[j]+=h.s[j]*(alphas[i]-b);}
  direction=Float64Array.from(direction,v=>-v);let slope=dot(current.gradient,direction);
  if(!(slope<0)){history=[];direction=Float64Array.from(current.gradient,v=>-v);slope=-dot(current.gradient,current.gradient);}
  let step=1,next,candidate,projected=false,retried=false;
  for(;;){
   candidate=Float64Array.from(x,(v,i)=>v+step*direction[i]);
   const unchanged=candidate.every((v,i)=>v===x[i]);next=unchanged?current:evaluate(candidate);
   const required=current.energy+1e-4*step*slope;
   if(Number.isFinite(next.energy)&&next.energy<current.energy&&next.energy<=required)break;
   if(unchanged||(required===current.energy&&next.energy===current.energy)){
    // Resolve an actual contact event only when ordinary descent runs out of
    // float64 energy resolution. Smooth-region L-BFGS steps remain unchanged.
    const crossing=breakpoint(x,direction,1);
    if(crossing){const atCrease=evaluate(crossing.candidate);
     if(atCrease.energy<=current.energy&&dot(atCrease.gradient,atCrease.gradient)<dot(current.gradient,current.gradient)){
      candidate=crossing.candidate;next=atCrease;projected=true;break;
     }
    }
    if(history.length&&!retried){history=[];retried=true;direction=Float64Array.from(current.gradient,v=>-v);slope=-dot(current.gradient,current.gradient);step=1;continue;}
    throw Error(`Finite sheet floating precision stagnation; residual ${maximum}`);
   }
   step*=.5;
  }
  if(projected){history=[];creaseProjections++;x=candidate;current=next;iterations++;continue;}
  onAcceptedStep(current,next);
  const s=Float64Array.from(candidate,(v,i)=>v-x[i]),y=Float64Array.from(next.gradient,(v,i)=>v-current.gradient[i]),sy=dot(s,y);
  if(sy>1e-14*Math.sqrt(dot(s,s)*dot(y,y))){history.push({s,y,rho:1/sy});if(history.length>8)history.shift();}
  x=candidate;current=next;iterations++;
 }
}
const index=(n,x,z)=>((z%n+n)%n)*n+(x%n+n)%n;
export function coatingCorner(field,n,x,z,opening=null){
 const incident=[index(n,x,z),index(n,x-1,z),index(n,x,z-1),index(n,x-1,z-1)].filter(i=>!opening||!opening[i]);return incident.length?incident.reduce((sum,i)=>sum+field[i],0)/incident.length:0;
}
export function sampleSheetObstacle(corners,n,x,z){
 x=(x-Math.floor(x))*n;z=(z-Math.floor(z))*n;const ix=Math.floor(x),iz=Math.floor(z),a=x-ix,b=z-iz;
 const plane=(cx,cz,upper)=>{const h00=corners[index(n,cx,cz)],h01=corners[index(n,cx,cz+1)],h11=corners[index(n,cx+1,cz+1)],h10=corners[index(n,cx+1,cz)];return upper?{height:(1-(z-cz))*h00+((z-cz)-(x-cx))*h01+(x-cx)*h11,dx:n*(h11-h01),dz:n*(h01-h00)}:{height:(1-(x-cx))*h00+(z-cz)*h11+((x-cx)-(z-cz))*h10,dx:n*(h10-h00),dz:n*(h11-h10)};};
 const result=plane(ix,iz,b>=a),epsilon=32*Number.EPSILON*Math.max(1,n),xs=[ix],zs=[iz],slopes=[];
 if(a<=epsilon)xs.push(ix-1);if(1-a<=epsilon)xs.push(ix+1);if(b<=epsilon)zs.push(iz-1);if(1-b<=epsilon)zs.push(iz+1);
 for(const cx of xs)for(const cz of zs){const u=x-cx,v=z-cz;if(u< -epsilon||u>1+epsilon||v< -epsilon||v>1+epsilon)continue;for(const upper of[true,false])if(upper?v>=u-epsilon:v<=u+epsilon){const p=plane(cx,cz,upper);if(!slopes.some(s=>s[0]===p.dx&&s[1]===p.dz))slopes.push([p.dx,p.dz]);}}
 return {...result,slopes};
}
// At an exact triangle crease the height is unchanged, but the derivative is
// a set of active-face slopes. Choose its minimum-norm Clarke gradient after
// adding the other forces; no normal smoothing or height smoothing is applied.
export function minimumContactSlope(sample,target){
 const points=sample.slopes??[[sample.dx,sample.dz]];if(points.length===1||!target.every(Number.isFinite))return points[0];
 const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),sorted=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),lower=[],upper=[];
 for(const p of sorted){while(lower.length>=2&&turn(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}for(const p of [...sorted].reverse()){while(upper.length>=2&&turn(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}const hull=[...lower.slice(0,-1),...upper.slice(0,-1)];
 if(hull.length>=3&&hull.every((p,i)=>turn(p,hull[(i+1)%hull.length],target)>=0))return target;
 let best=hull[0],distance=Infinity;for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length],d=[b[0]-a[0],b[1]-a[1]],length=d[0]**2+d[1]**2,t=length?Math.max(0,Math.min(1,((target[0]-a[0])*d[0]+(target[1]-a[1])*d[1])/length)):0,p=[a[0]+t*d[0],a[1]+t*d[1]],value=(target[0]-p[0])**2+(target[1]-p[1])**2;if(value<distance){distance=value;best=p;}}
 return best;
}
// Stop a line search at the first actual triangle-grid boundary reached by
// a contacting node. Snapping expresses that known geometric event exactly,
// rather than widening the contact surface or smoothing its creases.
export function sheetContactBreakpoint(u,direction,step,n,weights){
 let first=step,event=null;
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const j=(z*n+x)*3;if(weights&&!weights[z*n+x])continue;
  const a=x+n*u[j],b=z+n*u[j+2],da=n*direction[j],db=n*direction[j+2];
  for(const [value,delta,axis]of [[a,da,0],[b,db,2],[a-b,da-db,1]]){
   if(!delta)continue;const nearest=Math.round(value),active=Math.abs(value-nearest)<=32*Number.EPSILON*Math.max(1,n),cell=active?nearest:value,edge=delta>0?Math.floor(cell)+1:Math.ceil(cell)-1,t=(edge-value)/delta;
   if(t>0&&t<=first){first=t;event={j,x,z,axis,edge};}
  }
 }
 if(!event)return null;
 const candidate=Float64Array.from(u,(v,i)=>v+first*direction[i]),{j,x,z,axis,edge}=event;
 if(axis===0)candidate[j]=(edge-x)/n;
 else if(axis===2)candidate[j+2]=(edge-z)/n;
 else candidate[j]=candidate[j+2]+(edge-x+z)/n;
 return {step:first,candidate};
}
export function relaxFiniteCoating(s){
 const c=s.config,n=c.resolution,topology=periodicSheetTopology(n,s.opening),count=n*n,area=1/count;
 const steel=new Float64Array(count),oxide=new Float64Array(count),weights=new Float64Array(count),bondWeights=new Float64Array(count),multipliers=new Float64Array(count);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x;steel[i]=-c.metalScale*coatingCorner(s.metalLoss,n,x,z,s.opening);oxide[i]=-c.metalScale*coatingCorner(s.metalLoss,n,x,z)+c.metalScale*c.oxideExpansion*coatingCorner(s.rustIron,n,x,z)/(1-c.oxidePorosity);}
 for(const face of topology.faces)for(const i of face.vertices)weights[i]+=face.area/3;
 let u=s.filmDisplacement,penalty=c.attachmentStiffness*10,totalIterations=0,contactResidual=Infinity,failed;
 do{
  bondWeights.fill(0);for(const face of topology.faces)for(const i of face.vertices)bondWeights[i]+=s.bond[face.cell]*face.area/3;
  for(;;){
   const evaluate=u=>{const result=sheetElasticEnergy(topology,u,{stretching:c.sheetStretching,bending:c.plateBending,poisson:c.sheetPoisson}),g=result.gradient;if(!Number.isFinite(result.energy))return result;
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){
     const i=z*n+x,j=i*3;if(!weights[i])continue;const dy=u[j+1]-steel[i],k=c.attachmentStiffness*bondWeights[i];result.energy+=.5*k*(u[j]**2+dy**2+u[j+2]**2);g[j]+=k*u[j];g[j+1]+=k*dy;g[j+2]+=k*u[j+2];
     const h=sampleSheetObstacle(oxide,n,x/n+u[j],z/n+u[j+2]),gap=h.height-u[j+1],force=Math.max(0,multipliers[i]+penalty*gap);result.energy+=weights[i]*(force**2-multipliers[i]**2)/(2*penalty);const slope=minimumContactSlope(h,[-g[j]/(weights[i]*force),-g[j+2]/(weights[i]*force)]);g[j]+=weights[i]*force*slope[0];g[j+1]-=weights[i]*force;g[j+2]+=weights[i]*force*slope[1];
    }return result;
   };
   const solved=minimizeSheetEnergy(u,evaluate,c.mechanicalTolerance*area,()=>{},(x,d,step)=>sheetContactBreakpoint(x,d,step,n,weights));u=solved.x;totalIterations+=solved.iterations;contactResidual=0;
   for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x,j=i*3;if(!weights[i])continue;const gap=sampleSheetObstacle(oxide,n,x/n+u[j],z/n+u[j+2]).height-u[j+1];multipliers[i]=Math.max(0,multipliers[i]+penalty*gap);contactResidual=Math.max(contactResidual,Math.max(0,gap),multipliers[i]>0?Math.abs(gap):0);}
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
