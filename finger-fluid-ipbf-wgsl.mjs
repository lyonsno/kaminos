// Paper-derived mathematical kernel shared by native conformance and integration.
export const IPBF_MATH_WGSL = /* wgsl */`
struct IPBFKernel { value: f32, gradient: vec3<f32>, hessian: mat3x3<f32> }
fn ipbf_zero_matrix() -> mat3x3<f32> { return mat3x3<f32>(vec3<f32>(0),vec3<f32>(0),vec3<f32>(0)); }
fn ipbf_outer(v:vec3<f32>) -> mat3x3<f32> { return mat3x3<f32>(v*v.x,v*v.y,v*v.z); }
fn ipbf_diagonal(v:vec3<f32>) -> mat3x3<f32> { return mat3x3<f32>(vec3<f32>(v.x,0,0),vec3<f32>(0,v.y,0),vec3<f32>(0,0,v.z)); }
fn ipbf_kernel(offset:vec3<f32>,R:f32) -> IPBFKernel {
 var result:IPBFKernel;result.hessian=ipbf_zero_matrix();
 let radius=length(offset);let q=radius/R;let k=8.0/(3.141592653589793*R*R*R);
 if(q>=1.0){return result;}
 var f=2.0*pow(1.0-q,3.0);var first=-6.0*pow(1.0-q,2.0);var second=12.0*(1.0-q);
 if(q<0.5){f=1.0-6.0*q*q+6.0*q*q*q;first=-12.0*q+18.0*q*q;second=-12.0+36.0*q;}
 var u=vec3<f32>(0);if(radius>0.0){u=offset/radius;}
 let radial=k*second/(R*R);var tangent=radial;if(q>0.0){tangent=k*first/(q*R*R);}
 result.value=k*f;result.gradient=u*(k*first/R);
 result.hessian=ipbf_diagonal(vec3<f32>(tangent))+ipbf_outer(u)*(radial-tangent);return result;
}
fn ipbf_hessian_term(g:vec3<f32>,D:mat3x3<f32>,C:f32) -> mat3x3<f32> {
 return ipbf_outer(g)+ipbf_diagonal(vec3<f32>(length(D[0]*C),length(D[1]*C),length(D[2]*C)));
}
fn ipbf_solve(H:mat3x3<f32>,f:vec3<f32>) -> vec3<f32> {
 if(all(f==vec3<f32>(0))){return vec3<f32>(0);}
 let trace=H[0][0]+H[1][1]+H[2][2];
 if(trace>0.0){
  let candidate=f/trace;let residual=H*candidate-f;
  if(max(max(abs(residual.x),abs(residual.y)),abs(residual.z))<=0.000003814697265625*max(max(abs(f.x),abs(f.y)),abs(f.z))){return candidate;}
 }
 var activeH=H;
 if(all(H[0]==vec3<f32>(0))&&f.x==0.0){activeH[0][0]=1.0;}
 if(all(H[1]==vec3<f32>(0))&&f.y==0.0){activeH[1][1]=1.0;}
 if(all(H[2]==vec3<f32>(0))&&f.z==0.0){activeH[2][2]=1.0;}
 let l00=sqrt(activeH[0][0]);let l10=activeH[0][1]/l00;let l20=activeH[0][2]/l00;
 let l11=sqrt(activeH[1][1]-l10*l10);let l21=(activeH[1][2]-l20*l10)/l11;
 let l22=sqrt(activeH[2][2]-l20*l20-l21*l21);
 let y0=f.x/l00;let y1=(f.y-l10*y0)/l11;let y2=(f.z-l20*y0-l21*y1)/l22;
 let x2=y2/l22;let x1=(y1-l21*x2)/l11;let x0=(y0-l10*x1-l20*x2)/l00;
 return vec3<f32>(x0,x1,x2);
}
fn ipbf_damp(v:vec3<f32>,alternative:vec3<f32>,difference:f32,R:f32,beta:f32) -> vec3<f32> {
 let k=dot(v,v);let a=dot(alternative,alternative);let threshold=beta*R;
 if(k==0.0||a>=k||difference>=threshold){return v;}
 let d=1.0-difference/threshold;return v*sqrt(max(0.0,1.0-d*(k-a)/k));
}
struct IPBFBoundary { value:f32, gradient:vec3<f32>, hessian:mat3x3<f32> }
fn ipbf_halfspace(distance:f32,R:f32) -> vec3<f32> {
 if(distance>=R){return vec3<f32>(0);}
 if(distance<=-R){return vec3<f32>(1,0,0);}
 let q=abs(distance)/R;var value:f32;var first:f32;var second:f32;
 if(q<0.5){
  let q2=q*q;let q3=q2*q;let q4=q2*q2;let q5=q4*q;let q6=q3*q3;
  value=0.5-1.4*q+(8.0/3.0)*q3-4.8*q5+3.2*q6;
  first=-1.4+8.0*q2-24.0*q4+19.2*q5;
  second=16.0*q-96.0*q3+96.0*q4;
 }else{
  let t=1.0-q;let t2=t*t;let t3=t2*t;let t4=t2*t2;let t5=t4*t;
  value=t5*(1.6-(16.0/15.0)*t);first=t4*(-8.0+6.4*t);second=32.0*q*t3;
 }
 return vec3<f32>(select(value,1.0-value,distance<0.0),first/R,sign(distance)*second/(R*R));
}
fn ipbf_plane_boundary(frame:vec4<f32>,R:f32) -> IPBFBoundary {
 let b=ipbf_halfspace(frame.w,R);
 return IPBFBoundary(b.x,frame.xyz*b.y,ipbf_outer(frame.xyz)*b.z);
}
fn ipbf_union_boundary(a:IPBFBoundary,b:IPBFBoundary) -> IPBFBoundary {
 let crossTerms=mat3x3<f32>(a.gradient*b.gradient.x+b.gradient*a.gradient.x,a.gradient*b.gradient.y+b.gradient*a.gradient.y,a.gradient*b.gradient.z+b.gradient*a.gradient.z);
 return IPBFBoundary(a.value+b.value-a.value*b.value,a.gradient*(1.0-b.value)+b.gradient*(1.0-a.value),a.hessian*(1.0-b.value)+b.hessian*(1.0-a.value)-crossTerms);
}
`;

/** Dense all-pairs native conformance route. Integration reuses the math above
 * with the existing spatial grid; this driver has no production-scale claim. */
export const IPBF_CONFORMANCE_WGSL = IPBF_MATH_WGSL + /* wgsl */`
struct P { x:vec4<f32>, y:vec4<f32>, next:vec4<f32>, alternative:vec4<f32> }
struct S { density:vec4<f32>, gradient:vec4<f32>, h0:vec4<f32>, h1:vec4<f32>, h2:vec4<f32>, force:vec4<f32>, update:vec4<f32>, damped:vec4<f32> }
struct Params { count:u32, dt:f32, radius:f32, restDensity:f32, alpha:f32, alternativeAlpha:f32, beta:f32, damping:u32 }
@group(0) @binding(0) var<storage,read_write> particles:array<P>;
@group(0) @binding(1) var<storage,read_write> states:array<S>;
@group(0) @binding(2) var<uniform> params:Params;
@compute @workgroup_size(64)
fn density(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=params.count){return;}
 var rho=0.0;var gradient=vec3<f32>(0);var D=ipbf_zero_matrix();
 for(var j=0u;j<params.count;j++){
  let kernel=ipbf_kernel(particles[i].x.xyz-particles[j].x.xyz,params.radius);let mass=particles[j].x.w;
  rho+=mass*kernel.value;
  if(i!=j){gradient+=mass/params.restDensity*kernel.gradient;D+=kernel.hessian*(mass/params.restDensity);}
 }
 states[i].density=vec4<f32>(rho,max(rho/params.restDensity-1.0,0.0),0,0);
 states[i].gradient=vec4<f32>(gradient,0);states[i].h0=vec4<f32>(D[0],0);states[i].h1=vec4<f32>(D[1],0);states[i].h2=vec4<f32>(D[2],0);
}
@compute @workgroup_size(64)
fn solve(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=params.count){return;}
 var force=vec3<f32>(0);var H=ipbf_zero_matrix();
 for(var j=0u;j<params.count;j++){
  let C=states[j].density.y;if(C==0.0){continue;}
  let kernel=ipbf_kernel(particles[i].x.xyz-particles[j].x.xyz,params.radius);
  if(i!=j&&kernel.value==0.0){continue;}
  var g=kernel.gradient*(particles[i].x.w/params.restDensity);var D=kernel.hessian*(particles[i].x.w/params.restDensity);
  if(i==j){g=states[i].gradient.xyz;D=mat3x3<f32>(states[i].h0.xyz,states[i].h1.xyz,states[i].h2.xyz);}
  force-=C*g;H+=ipbf_hessian_term(g,D,C);
 }
 let displacement=particles[i].x.xyz-particles[i].y.xyz;
 let inertia=params.alpha*particles[i].x.w/(params.dt*params.dt);
 let totalH=H+ipbf_diagonal(vec3<f32>(inertia));let totalF=force-inertia*displacement;
 let delta=ipbf_solve(totalH,totalF);states[i].force=vec4<f32>(totalF,0);states[i].update=vec4<f32>(delta,0);
 particles[i].next=vec4<f32>(particles[i].x.xyz+0.5*delta,particles[i].x.w);
 let alternativeInertia=params.alternativeAlpha*particles[i].x.w/(params.dt*params.dt);
 let alternative=particles[i].x.xyz+0.5*ipbf_solve(H+ipbf_diagonal(vec3<f32>(alternativeInertia)),force-alternativeInertia*displacement);
 particles[i].alternative=vec4<f32>(alternative,particles[i].x.w);
}
@compute @workgroup_size(64)
fn commit(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=params.count){return;}particles[i].x=particles[i].next;
}
`;

/** Native conformance for fixed planes, without changing the particle buffer
 * or runtime params. The CPU numerical reference accepts the same planes. */
export function createIPBFConformanceShader(planes=[]){
 if(!Array.isArray(planes)||planes.some(p=>!p||!Array.isArray(p.normal)||p.normal.length!==3||p.normal.some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...p.normal)-1)>1e-8||!Number.isFinite(p.offset)))throw new TypeError('IPBF boundary planes require finite unit normals and offsets');
 const expressions=planes.map(p=>`boundary=ipbf_union_boundary(boundary,ipbf_plane_boundary(vec4<f32>(vec3<f32>(${p.normal.join(',')}),dot(vec3<f32>(${p.normal.join(',')}),position)-(${p.offset})),params.radius));`).join('\n');
 const helper=`fn ipbf_conformance_boundary(position:vec3<f32>) -> IPBFBoundary {var boundary=IPBFBoundary(0.0,vec3<f32>(0),ipbf_zero_matrix());${expressions}return boundary;}\n`;
 return IPBF_CONFORMANCE_WGSL.replace('@compute @workgroup_size(64)\nfn density',helper+'@compute @workgroup_size(64)\nfn density').replace('states[i].density=vec4<f32>(rho,','let boundary=ipbf_conformance_boundary(particles[i].x.xyz);rho+=params.restDensity*boundary.value;gradient+=boundary.gradient;D+=boundary.hessian;\n states[i].density=vec4<f32>(rho,');
}

export function createIPBFGridShader({radius,volume,compliance=0,alternativeCompliance=.001,damping=true,beta=60,boundaryMode='collision_only',obstacleCenter=null,obstacleRadius=null,dynamicControls=false}){
 for(const [name,value] of Object.entries({radius,volume,compliance,alternativeCompliance}))if(!Number.isFinite(value)||value<0||(['radius','volume'].includes(name)&&value===0))throw new RangeError(`IPBF ${name} invalid`);
 if(!['collision_only','tangent_plane'].includes(boundaryMode))throw new RangeError(`IPBF boundary mode invalid: ${boundaryMode}`);
 if(boundaryMode==='tangent_plane'&&(!Array.isArray(obstacleCenter)||obstacleCenter.length!==3||obstacleCenter.some(v=>!Number.isFinite(v))||!Number.isFinite(obstacleRadius)||obstacleRadius<=0))throw new RangeError('IPBF wall support requires the host obstacle geometry');
 const wall=boundaryMode==='tangent_plane'?`
 fn ipbf_host_boundary(position:vec3<f32>) -> IPBFBoundary {
  // Physical wall, before collision-radius expansion. Curvature is frozen as
  // a tangent plane for this local pressure solve, not an exact solid integral.
  var boundary=ipbf_plane_boundary(supportSignedDistanceFrame(position,0.0),ipbfRadius);
  if(analyticObstacleSupportEnabled){
   let offset=position-vec3<f32>(${obstacleCenter?.join(',')});let distance=length(offset);
   var normal=vec3<f32>(0,1,0);if(distance>0.0){normal=offset/distance;}
   boundary=ipbf_union_boundary(boundary,ipbf_plane_boundary(vec4<f32>(normal,distance-${obstacleRadius}),ipbfRadius));
  }
  return boundary;
 }`:'';
 const neighbors=body=>`
 let minimum=gridCoord(position-vec3<f32>(ipbfRadius));let maximum=gridCoord(position+vec3<f32>(ipbfRadius));
 for(var z=minimum.z;z<=maximum.z;z++){for(var y=minimum.y;y<=maximum.y;y++){for(var x=minimum.x;x<=maximum.x;x++){
  var current=atomicLoad(&cellHeads[cellIndex(vec3<i32>(x,y,z))]);
  while(current>=0){let j=u32(current);if(particles[j].velocity.w>=0.0){${body}}current=particleNext[j];}
 }}}
 `;
 const source=IPBF_MATH_WGSL+`
 const ipbfRadius:f32=${radius};const ipbfVolume:f32=${volume};
 const ipbfAlpha:f32=${compliance};const ipbfAlternativeAlpha:f32=${alternativeCompliance};
 const ipbfDampingEnabled:bool=${damping};const ipbfBeta:f32=${beta};
 ${wall}
 struct IPBFState { inertial:vec4<f32>, gradient:vec4<f32>, h0:vec4<f32>, h1:vec4<f32>, h2:vec4<f32>, alternative:vec4<f32> }
 @group(1) @binding(0) var<storage,read_write> ipbfStates:array<IPBFState>;
 @compute @workgroup_size(64)
 fn ipbf_velocity(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;if(i>=params.particleCount){return;}
  let position=particles[i].predicted.xyz;
  var velocity=(position-particles[i].position.xyz)/params.dt;
  if(ipbfDampingEnabled){let alternate=ipbfStates[i].alternative.xyz;velocity=ipbf_damp(velocity,(alternate-particles[i].position.xyz)/params.dt,distance(position,alternate),ipbfRadius,ipbfBeta);}
  // Publish one reconstructed, paper-damped field before viscosity reads
  // neighbors. Viscosity writes delta only, leaving this input immutable.
  particles[i].velocity=vec4<f32>(velocity,particles[i].velocity.w);
  particles[i].delta=vec4<f32>(velocity,particles[i].delta.w);
 }
 @compute @workgroup_size(64)
 fn ipbf_prepare(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;if(i>=params.particleCount){return;}ipbfStates[i].inertial=particles[i].predicted;}
 @compute @workgroup_size(64)
 fn ipbf_density(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;if(i>=params.particleCount){return;}
  if(particles[i].velocity.w<0.0){particles[i].predicted.w=0.0;particles[i].delta.w=0.0;return;}
  let position=particles[i].predicted.xyz;var rho=0.0;var gradient=vec3<f32>(0);var D=ipbf_zero_matrix();
  ${neighbors(`let kernel=ipbf_kernel(position-particles[j].predicted.xyz,ipbfRadius);rho+=ipbfVolume*kernel.value;if(i!=j){gradient+=ipbfVolume*kernel.gradient;D+=kernel.hessian*ipbfVolume;}`)}
  ${boundaryMode==='tangent_plane'?'let boundary=ipbf_host_boundary(position);rho+=boundary.value;gradient+=boundary.gradient;D+=boundary.hessian;':''}
  particles[i].predicted.w=max(rho-1.0,0.0);particles[i].delta.w=rho*params.fluid.y;
  ipbfStates[i].gradient=vec4<f32>(gradient,0);ipbfStates[i].h0=vec4<f32>(D[0],0);ipbfStates[i].h1=vec4<f32>(D[1],0);ipbfStates[i].h2=vec4<f32>(D[2],0);
 }
 @compute @workgroup_size(64)
 fn ipbf_delta(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;if(i>=params.particleCount||particles[i].velocity.w<0.0){return;}
  let position=particles[i].predicted.xyz;var force=vec3<f32>(0);var H=ipbf_zero_matrix();
  ${neighbors(`let C=particles[j].predicted.w;if(C>0.0){let kernel=ipbf_kernel(position-particles[j].predicted.xyz,ipbfRadius);if(i==j||kernel.value>0.0){var g=kernel.gradient*ipbfVolume;var D=kernel.hessian*ipbfVolume;if(i==j){g=ipbfStates[i].gradient.xyz;D=mat3x3<f32>(ipbfStates[i].h0.xyz,ipbfStates[i].h1.xyz,ipbfStates[i].h2.xyz);}force-=C*g;H+=ipbf_hessian_term(g,D,C);}}`)}
  let displacement=position-ipbfStates[i].inertial.xyz;
  let inertia=ipbfAlpha*ipbfVolume/(params.dt*params.dt);
  let delta=ipbf_solve(H+ipbf_diagonal(vec3<f32>(inertia)),force-inertia*displacement);
  particles[i].delta=vec4<f32>(0.5*delta,particles[i].delta.w);
  let altInertia=ipbfAlternativeAlpha*ipbfVolume/(params.dt*params.dt);
  ipbfStates[i].alternative=vec4<f32>(pressure_candidate_position(i,position,0.5*ipbf_solve(H+ipbf_diagonal(vec3<f32>(altInertia)),force-altInertia*displacement)),0);
 }
 `;
 if(!dynamicControls)return source;
 const live=source.replace(`const ipbfRadius:f32=${radius};`,'')
  .replace(`const ipbfBeta:f32=${beta};`,'')
  .replace(/\bipbfRadius\b/g,'ipbfControls.radius')
  .replace(/\bipbfBeta\b/g,'ipbfControls.beta');
 return `struct IPBFControlUniforms { radius:f32, beta:f32, padding:vec2<f32> }
 @group(1) @binding(1) var<uniform> ipbfControls:IPBFControlUniforms;
 `+live;
}
