/** CPU reference for Diaz et al., IPBF (2025), paper SHA 1ebe17ec…159.
 * Canonical energy is Eq.7: alpha/(2 dt²) Σ m|x-y|² + 1/2 Σ max(rho/rho0-1,0)².
 * Eq.10/11's extra 1/2 conflicts with Eq.7 and Eq.15; differentiate Eq.7.
 * This factor cancels at alpha=0; nonzero compliance follows the stated energy.
 * No PBF correction caps, tensile term, or artificial relaxation are inherited.
 */
const zero=()=>[0,0,0];
const matrix=()=>[zero(),zero(),zero()];
const norm=v=>Math.hypot(...v);
const scale=(v,s)=>v.map(x=>x*s);
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const positive=(x,n)=>{if(!Number.isFinite(x)||x<=0)throw new RangeError(`${n} must be finite and positive`);};
const vectors=(x,n,count)=>{
 if(!Array.isArray(x)||x.length===0||(count!==undefined&&x.length!==count)||x.some(v=>!Array.isArray(v)||v.length!==3||v.some(t=>!Number.isFinite(t))))throw new TypeError(`${n} must contain finite 3D vectors with matching count`);
};

/** Normalized 3D cubic spline with support R (smoothing length R/2). */
export function cubicSplineKernel(offset,supportRadius){
 positive(supportRadius,'supportRadius');
 if(!Array.isArray(offset)||offset.length!==3||offset.some(t=>!Number.isFinite(t)))throw new TypeError('kernel offset must be a finite 3D vector');
 const r=norm(offset),q=r/supportRadius,k=8/(Math.PI*supportRadius**3);
 if(q>=1)return {value:0,gradient:zero(),hessian:matrix()};
 const f=q<.5?1-6*q*q+6*q*q*q:2*(1-q)**3;
 const first=q<.5?-12*q+18*q*q:-6*(1-q)**2;
 const second=q<.5?-12+36*q:12*(1-q);
 const u=r>0?scale(offset,1/r):zero(),radial=k*second/(supportRadius**2),tangent=q>0?k*first/(q*supportRadius**2):radial;
 const H=matrix();for(let a=0;a<3;a++)for(let b=0;b<3;b++)H[a][b]=(a===b?tangent:0)+(radial-tangent)*u[a]*u[b];
 return {value:k*f,gradient:scale(u,k*first/supportRadius),hessian:H};
}

function validate(s){
 vectors(s.positions,'positions');vectors(s.inertial,'inertial',s.positions.length);
 if(!Array.isArray(s.masses)||s.masses.length!==s.positions.length||s.masses.some(m=>!Number.isFinite(m)||m<=0))throw new TypeError('masses must be finite positive values matching positions');
 positive(s.restDensity,'restDensity');positive(s.supportRadius,'supportRadius');positive(s.dt,'dt');
 if(!Number.isFinite(s.compliance)||s.compliance<0)throw new RangeError('compliance must be finite and nonnegative');
}

function solveSymmetric(H,f){
 if(f.every(x=>x===0))return zero();
 // Cholesky without a tunable regularizer: the paper's column-norm diagonal
 // makes active pressure blocks positive; compliance adds a positive diagonal.
 const L=matrix();
 for(let i=0;i<3;i++)for(let j=0;j<=i;j++){
  let v=H[i][j];for(let k=0;k<j;k++)v-=L[i][k]*L[j][k];
  if(i===j){if(!(v>0)||!Number.isFinite(v))throw new Error('IPBF local Hessian is not positive definite');L[i][j]=Math.sqrt(v);}
  else L[i][j]=v/L[j][j];
 }
 const y=zero(),x=zero();
 for(let i=0;i<3;i++){let v=f[i];for(let j=0;j<i;j++)v-=L[i][j]*y[j];y[i]=v/L[i][i];}
 for(let i=2;i>=0;i--){let v=y[i];for(let j=i+1;j<3;j++)v-=L[j][i]*x[j];x[i]=v/L[i][i];}
 return x;
}

export function evaluateIPBF(state){
 const s={compliance:0,...state};validate(s);
 const {positions:x,inertial:y,masses:m,restDensity:rho0,supportRadius:R,dt,compliance:alpha}=s,n=x.length;
 const kernels=x.map(a=>x.map(b=>cubicSplineKernel(sub(a,b),R)));
 const densities=x.map((_,i)=>m.reduce((v,mj,j)=>v+mj*kernels[i][j].value,0));
 const constraints=densities.map(rho=>Math.max(rho/rho0-1,0));
 const selfGradients=x.map(()=>zero()),selfHessians=x.map(()=>matrix());
 for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(j!==i){
  selfGradients[i]=add(selfGradients[i],scale(kernels[i][j].gradient,m[j]/rho0));
  for(let a=0;a<3;a++)for(let b=0;b<3;b++)selfHessians[i][a][b]+=m[j]/rho0*kernels[i][j].hessian[a][b];
 }
 let energy=0;
 const forces=[],hessians=[],updates=[],localTerms=[];
 for(let i=0;i<n;i++){
  const inertia=alpha*m[i]/(dt*dt),displacement=sub(x[i],y[i]);
  energy+=.5*constraints[i]**2+.5*inertia*dot(displacement,displacement);
  const f=scale(displacement,-inertia),H=matrix(),terms=[];
  for(let a=0;a<3;a++)H[a][a]=inertia;
  for(let j=0;j<n;j++){
   if(constraints[j]===0||(j!==i&&kernels[i][j].value===0))continue;
   const g=j===i?selfGradients[i]:scale(kernels[i][j].gradient,m[i]/rho0);
   const D=j===i?selfHessians[i]:kernels[i][j].hessian.map(row=>scale(row,m[i]/rho0));
   const C=constraints[j];terms.push({source:j,constraint:C,gradient:g,hessian:D});
   for(let a=0;a<3;a++){
    f[a]-=C*g[a];
    for(let b=0;b<3;b++)H[a][b]+=g[a]*g[b];
    H[a][a]+=Math.hypot(...D.map(row=>C*row[a]));
   }
  }
  forces.push(f);hessians.push(H);updates.push(solveSymmetric(H,f));localTerms.push(terms);
 }
 return {energy,densities,constraints,selfGradients,selfHessians,forces,hessians,updates,localTerms};
}

export function iterateIPBF(state){
 const evaluation=evaluateIPBF(state);
 return {...evaluation,positions:state.positions.map((x,i)=>add(x,scale(evaluation.updates[i],.5)))};
}

export function dampIPBFVelocity({velocity,alternativeVelocity,positionDifference,supportRadius,beta=60}){
 vectors([velocity,alternativeVelocity],'velocities');positive(supportRadius,'supportRadius');positive(beta,'beta');
 if(!Number.isFinite(positionDifference)||positionDifference<0)throw new RangeError('positionDifference must be finite and nonnegative');
 const k=dot(velocity,velocity),alt=dot(alternativeVelocity,alternativeVelocity),threshold=beta*supportRadius;
 if(k===0||alt>=k||positionDifference>=threshold)return velocity.slice();
 const d=1-positionDifference/threshold;
 return scale(velocity,Math.sqrt(Math.max(0,1-d*(k-alt)/k)));
}

export function stepIPBF(state){
 const {iterations=3,velocities,accelerations=state.positions.map(()=>zero()),damping=true,alternativeCompliance=.001,beta=60}=state;
 if(!Number.isSafeInteger(iterations)||iterations<1)throw new RangeError('iterations must be a positive safe integer');
 vectors(state.positions,'positions');vectors(velocities,'velocities',state.positions.length);vectors(accelerations,'accelerations',state.positions.length);
 if(!Number.isFinite(alternativeCompliance)||alternativeCompliance<0)throw new RangeError('alternativeCompliance must be finite and nonnegative');
 positive(beta,'beta');positive(state.dt,'dt');
 const y=state.positions.map((x,i)=>add(x,add(scale(velocities[i],state.dt),scale(accelerations[i],state.dt**2))));
 let positions=y,alternativePositions=null;
 for(let i=0;i<iterations;i++){
  const input={...state,positions,inertial:y};
  if(damping&&i===iterations-1)alternativePositions=iterateIPBF({...input,compliance:alternativeCompliance}).positions;
  positions=iterateIPBF(input).positions;
 }
 const resultVelocities=positions.map((x,i)=>{
  const v=scale(sub(x,state.positions[i]),1/state.dt);
  if(!damping)return v;
  return dampIPBFVelocity({velocity:v,alternativeVelocity:scale(sub(alternativePositions[i],state.positions[i]),1/state.dt),positionDifference:norm(sub(x,alternativePositions[i])),supportRadius:state.supportRadius,beta});
 });
 return {positions,velocities:resultVelocities,alternativePositions,effective:{kernel:'cubic_spline',relaxation:.5,compliance:state.compliance??0,iterations,damping,alternativeCompliance,beta,dt:state.dt}};
}
