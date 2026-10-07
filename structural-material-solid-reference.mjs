import { Matrix3 } from 'three';

// Reference energy/gradient primitives, not a dynamic solver or a faithful full paper port.
const axes=[0,1,2],I=[1,0,0,0,1,0,0,0,1];
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),scale=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),outer=(a,b)=>a.flatMap(v=>b.map(w=>v*w));
const transpose=a=>axes.flatMap(i=>axes.map(j=>a[j*3+i]));
const multiply=(a,b)=>axes.flatMap(i=>axes.map(j=>axes.reduce((s,k)=>s+a[i*3+k]*b[k*3+j],0)));
const apply=(a,x)=>axes.map(i=>axes.reduce((s,j)=>s+a[i*3+j]*x[j],0));
const columns=v=>axes.flatMap(i=>v.map(p=>p[i]));
const determinant=a=>new Matrix3().set(...a).determinant();
function inverse(a){const magnitude=Math.max(...a.map(Math.abs));if(!(magnitude>0))throw new Error('Degenerate or rank-deficient matrix');
  const m=new Matrix3().set(...scale(a,1/magnitude));if(!(Math.abs(m.determinant())>1e-12))throw new Error('Degenerate or rank-deficient matrix');m.invert();return axes.flatMap(i=>axes.map(j=>m.elements[j*3+i]/magnitude));}
function inverseSquare(a){
  const n=a.length,magnitude=Math.max(...a.flat().map(Math.abs));if(!(magnitude>0))throw new Error('Degenerate directional strain basis');
  const m=a.map((row,i)=>[...row.map(v=>v/magnitude),...Array.from({length:n},(_,j)=>Number(i===j))]);
  for(let k=0;k<n;k++){
    let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[pivot][k]))pivot=i;
    if(!(Math.abs(m[pivot][k])>1e-12))throw new Error('Degenerate directional strain basis');
    [m[k],m[pivot]]=[m[pivot],m[k]];const divisor=m[k][k];m[k]=m[k].map(v=>v/divisor);
    for(let i=0;i<n;i++)if(i!==k){const factor=m[i][k];m[i]=m[i].map((v,j)=>v-factor*m[k][j]);}
  }
  return m.map(row=>row.slice(n).map(v=>v/magnitude));
}
function points(p,count){if(!Array.isArray(p)||p.length!==count||!p.every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))throw new Error('Finite 3D material points required');}
function elasticity({young,poisson}){
  if(!(Number.isFinite(young)&&young>0&&Number.isFinite(poisson)&&poisson>-1&&poisson<.5))throw new Error('Material requires positive Young modulus and -1 < Poisson ratio < .5');
  return{mu:young/(2*(1+poisson)),lambda:young*poisson/((1+poisson)*(1-2*poisson))};
}
const pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
const strainVector=F=>{const c=multiply(transpose(F),F);return[(c[0]-1)/2,(c[4]-1)/2,(c[8]-1)/2,c[1],c[2],c[5]];};
const stressMatrix=s=>[s[0],s[3],s[4],s[3],s[1],s[5],s[4],s[5],s[2]];
const Capply=(e,{mu,lambda})=>{const tr=e[0]+e[1]+e[2];return[e[0]*2*mu+lambda*tr,e[1]*2*mu+lambda*tr,e[2]*2*mu+lambda*tr,e[3]*mu,e[4]*mu,e[5]*mu];};
function deformationResult(F,S,energy,forces,extra={}){
  const J=determinant(F);if(!(J>0))throw new Error('Inverted deformation is outside this material reference');
  const P=multiply(F,S),cauchy=scale(multiply(P,transpose(F)),1/J);
  return{active:true,energy,forces,deformationGradient:F,stress:S,stressMeasure:'second-piola',cauchyStress:cauchy,firstPiola:P,...extra};
}
export function graphTetrahedron(rest,material){
  points(rest,4);rest=structuredClone(rest);const elastic=elasticity(material);
  const Dm=columns(rest.slice(1).map(p=>sub(p,rest[0]))),invDm=inverse(Dm),volume=Math.abs(determinant(Dm))/6;
  const gradients=[scale(add(add(invDm.slice(0,3),invDm.slice(3,6)),invDm.slice(6,9)),-1),invDm.slice(0,3),invDm.slice(3,6),invDm.slice(6,9)];
  const T=pairs.map(([i,j])=>{const e=sub(rest[j],rest[i]),d=scale(e,1/Math.sqrt(dot(e,e)));return[d[0]**2,d[1]**2,d[2]**2,2*d[0]*d[1],2*d[0]*d[2],2*d[1]*d[2]];});
  inverseSquare(T);
  const C=Array.from({length:6},(_,j)=>Capply(Array.from({length:6},(_,k)=>Number(k===j)),elastic));
  const stiffness=new Map();
  function releasedStiffness(alive){
    const key=alive.map(Number).join('');if(stiffness.has(key))return stiffness.get(key);
    const B=T.filter((_,i)=>!alive[i]);let result;
    if(!B.length)result=C.map(row=>[...row]);else if(B.length===6)result=Array.from({length:6},()=>Array(6).fill(0));
    else{
      // Minimize elastic energy over the released strain directions: C - C B^T (B C B^T)^-1 B C.
      const CB=B.map(row=>C.map(c=>dot(c,row))),Q=B.map(row=>CB.map(column=>dot(row,column))),invQ=inverseSquare(Q);
      result=C.map((row,i)=>row.map((v,j)=>v-CB.reduce((sum,column,a)=>sum+column[i]*invQ[a].reduce((s,q,b)=>s+q*CB[b][j],0),0)));
    }
    stiffness.set(key,result);return result;
  }
  return{route:'graph-directional-stvk-reference-v0',volume,rest,gradients,directionalBasis:T,
    evaluate(current,alive=Array(6).fill(true)){
      points(current,4);if(!Array.isArray(alive)||alive.length!==6||!alive.every(v=>typeof v==='boolean'))throw new Error('Six boolean graph-edge states required');
      const F=multiply(columns(current.slice(1).map(p=>sub(p,current[0]))),invDm),e=strainVector(F);
      const s=releasedStiffness(alive).map(row=>dot(row,e));
      const S=stressMatrix(s),P=multiply(F,S),energy=volume*dot(e,s)/2,forces=gradients.map(g=>scale(apply(P,g),-volume));
      return deformationResult(F,S,energy,forces,{alive:[...alive]});
    }};
}

export function correspondencePoint(center,neighbors,{volume,neighborVolumes,weights,stabilization=0,...material}){
  points([center],1);points(neighbors,neighbors.length);const elastic=elasticity(material);
  if(!(Number.isFinite(volume)&&volume>0&&Number.isFinite(stabilization)&&stabilization>=0)
    ||!Array.isArray(neighborVolumes)||!Array.isArray(weights)||neighborVolumes.length!==neighbors.length||weights.length!==neighbors.length
    ||!neighborVolumes.every(v=>Number.isFinite(v)&&v>0)||!weights.every(v=>Number.isFinite(v)&&v>0))throw new Error('Positive material point volumes/weights and nonnegative stabilization required');
  const xi=neighbors.map(p=>sub(p,center)),coefficients=weights.map((v,i)=>v*neighborVolumes[i]);
  return{route:'stabilized-correspondence-stvk-reference-v0',damageAdmission:'diagnostic-only-neighborhood-refit-energy-defect',volume,restCenter:[...center],restNeighbors:structuredClone(neighbors),
    evaluate(currentCenter,currentNeighbors,alive=Array(neighbors.length).fill(true)){
      points([currentCenter],1);points(currentNeighbors,neighbors.length);
      if(!Array.isArray(alive)||alive.length!==neighbors.length||!alive.every(v=>typeof v==='boolean'))throw new Error('Boolean peridynamic bond states required');
      if(!alive.some(Boolean))return{active:false,energy:0,stabilizationEnergy:0,forces:Array.from({length:neighbors.length+1},()=>[0,0,0]),degradation:'fully-disconnected'};
      const k=coefficients.map((v,i)=>alive[i]?v:0),y=currentNeighbors.map(p=>sub(p,currentCenter));
      const K=xi.reduce((sum,p,i)=>add(sum,scale(outer(p,p),k[i])),Array(9).fill(0)),invK=inverse(K);
      const A=y.reduce((sum,p,i)=>add(sum,scale(outer(p,xi[i]),k[i])),Array(9).fill(0)),F=multiply(A,invK);
      const e=strainVector(F),s=Capply(e,elastic),S=stressMatrix(s),P=multiply(F,S),PK=multiply(P,invK);
      const residual=y.map((p,i)=>sub(p,apply(F,xi[i]))),trK=K[0]+K[4]+K[8],penalty=volume*elastic.mu*stabilization/trK;
      const stabilizationEnergy=penalty*residual.reduce((sum,r,i)=>sum+k[i]*dot(r,r),0)/2;
      const neighborForces=xi.map((p,i)=>scale(add(scale(apply(PK,p),volume),scale(residual[i],penalty)),-k[i]));
      const centerForce=scale(neighborForces.reduce(add,[0,0,0]),-1),energy=volume*dot(e,s)/2+stabilizationEnergy;
      return deformationResult(F,S,energy,[centerForce,...neighborForces],{alive:[...alive],stabilizationEnergy,shapeTensor:K});
    }};
}

// PMB peridynamics: LAMMPS Howto_peri, micromodulus 18 K / (pi delta^4), 3D nu=1/4.
export function microelasticBonds(rest,links,{young,poisson,horizon,volumes}){
  points(rest,rest.length);elasticity({young,poisson});
  if(poisson!==.25)throw new Error('3D prototype microelastic brittle material requires Poisson ratio .25');
  if(!(Number.isFinite(horizon)&&horizon>0)||!Array.isArray(volumes)||volumes.length!==rest.length||!volumes.every(v=>Number.isFinite(v)&&v>0))throw new Error('Positive peridynamic horizon/point volumes required');
  const bulk=young/(3*(1-2*poisson)),micromodulus=18*bulk/(Math.PI*horizon**4),seen=new Set();
  const bonds=links.map(([a,b])=>{
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<=a||b>=rest.length||seen.has(`${a}:${b}`))throw new Error('Unique ordered peridynamic bond indices required');seen.add(`${a}:${b}`);
    const length=Math.hypot(...sub(rest[b],rest[a]));if(!(length>0&&length<=horizon))throw new Error('Peridynamic bond exceeds horizon or has zero length');
    return{a,b,restLength:length,stiffness:micromodulus*volumes[a]*volumes[b]/length};
  });
  return{route:'pmb-microelastic-reference-v0',bonds,micromodulus,material:{young,poisson,horizon},
    evaluate(current,alive=Array(bonds.length).fill(true)){
      points(current,rest.length);if(!Array.isArray(alive)||alive.length!==bonds.length||!alive.every(v=>typeof v==='boolean'))throw new Error('Boolean microelastic bond states required');
      const forces=rest.map(()=>[0,0,0]);let energy=0;
      const bondStates=bonds.map((bond,i)=>{
        const delta=sub(current[bond.b],current[bond.a]),length=Math.hypot(...delta),extension=length-bond.restLength;
        if(!(length>0))throw new Error('Coincident live material points are outside the PMB reference');
        const stored=alive[i]?bond.stiffness*extension**2/2:0;
        if(alive[i]){const force=scale(delta,bond.stiffness*extension/length);forces[bond.a]=add(forces[bond.a],force);forces[bond.b]=sub(forces[bond.b],force);}
        energy+=stored;return{...bond,alive:alive[i],stretch:extension/bond.restLength,energy:stored};
      });
      return{energy,forces,bonds:bondStates};
    }};
}
