// Optical coefficients are volume integrals of emissivity (per steradian) and
// extinction. A kernel is a normalized, finite ellipsoidal Gaussian measure.
const SQRT2=Math.SQRT2, SQRT2PI=Math.sqrt(2*Math.PI);
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
export function gaussianErfc(x){
 const a=Math.abs(x),t=1/(1+.5*a);
 const e=t*Math.exp(-a*a-1.26551223+t*(1.00002368+t*(.37409196+t*(.09678418+t*(-.18628806+t*(.27886807+t*(-1.13520398+t*(1.48851587+t*(-.82215223+t*.17087277)))))))));
 return x<0?2-e:e;
}
export function gaussianNormalInterval(lo,hi){
 if(!(hi>lo))return 0;
 // Direct density integration avoids subtracting rounded, almost equal CDFs.
 if(hi-lo<.5){const m=(lo+hi)/2,h=(hi-lo)/2;let sum=0;
  for(const [x,w]of [[.3399810435848563,.6521451548625461],[.8611363115940526,.3478548451374538]])sum+=w*(Math.exp(-.5*(m-h*x)**2)+Math.exp(-.5*(m+h*x)**2));
  return h*sum/SQRT2PI;
 }
 if(lo>=0)return Math.max(0,.5*(gaussianErfc(lo/SQRT2)-gaussianErfc(hi/SQRT2)));
 if(hi<=0)return Math.max(0,.5*(gaussianErfc(-hi/SQRT2)-gaussianErfc(-lo/SQRT2)));
 return Math.max(0,1-.5*(gaussianErfc(hi/SQRT2)+gaussianErfc(-lo/SQRT2)));
}
const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)))throw Error('Invalid optical '+name);return [...v];};
export function opticalGaussian({id,generation=0,center,radii,axes=[[1,0,0],[0,1,0],[0,0,1]],supportSigmas=4,emission=[0,0,0],extinction=0}){
 center=vector(center,'center');radii=vector(radii,'radii');emission=vector(emission,'emission');
 if(!['number','string'].includes(typeof id)||(typeof id==='number'&&!Number.isFinite(id))||!Number.isSafeInteger(generation)||generation<0||radii.some(x=>x<=0)||emission.some(x=>x<0)||!(extinction>=0&&Number.isFinite(extinction))||!(supportSigmas>0&&Number.isFinite(supportSigmas)))throw Error('Invalid optical Gaussian measure');
 if(!Array.isArray(axes)||axes.length!==3)throw Error('Invalid optical axes');axes=axes.map(a=>vector(a,'axis'));
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(Math.abs(dot(axes[i],axes[j])-(i===j?1:0))>1e-6)throw Error('Optical axes must be orthonormal');
 const s=supportSigmas;let mass;
 // The small-support series avoids cancellation; the analytic large-support
 // expression does not lose the central density in a widening fixed stencil.
 if(s<=2){let term=s*s*s/3,sum=term,n=0;
  do{term*=(-s*s/2)*(2*n+3)/((n+1)*(2*n+5));sum+=term;n++;}while(Math.abs(term)>Number.EPSILON*Math.abs(sum));
  mass=Math.sqrt(2/Math.PI)*sum;
 }else mass=gaussianNormalInterval(-s,s)-Math.sqrt(2/Math.PI)*s*Math.exp(-s*s/2);
 const normalization=1/(Math.pow(2*Math.PI,1.5)*radii.reduce((a,b)=>a*b,1)*mass);
 if(!(normalization>0&&Number.isFinite(normalization)))throw Error('Optical Gaussian normalization is not representable');
 return {id,generation,center,radii,axes,supportSigmas:s,emission,extinction,normalization,mass,bound:Math.max(...radii)*s};
}
function local(kernel,v){return kernel.axes.map((axis,i)=>dot(axis,v)/kernel.radii[i]);}
export function opticalGaussianDensity(kernel,point){const v=local(kernel,point.map((x,i)=>x-kernel.center[i])),q=dot(v,v);return q>kernel.supportSigmas**2?0:kernel.normalization*Math.exp(-q/2);}
export function opticalGaussianRay(kernel,origin,direction,start=0,end=Infinity){
 const v=local(kernel,direction),d=local(kernel,origin.map((x,i)=>x-kernel.center[i]));
 const a=dot(v,v);if(!(a>0))return null;
 const b=dot(v,d),mean=-b/a,perpendicular=d.map((x,i)=>x+v[i]*mean),residual=dot(perpendicular,perpendicular),remaining=kernel.supportSigmas**2-residual;
 if(remaining<=0)return null;
 const radius=Math.sqrt(remaining/a),lo=Math.max(start,mean-radius),hi=Math.min(end,mean+radius);
 if(!(hi>lo))return null;
 const scale=Math.sqrt(a),cdf=gaussianNormalInterval((lo-mean)*scale,(hi-mean)*scale);
 return {lo,hi,mean,scale,cdf,integral:kernel.normalization*Math.exp(-residual/2)*SQRT2PI/scale*cdf};
}
export function opticalGaussianSegment(kernel,start,end){
 const delta=end.map((x,i)=>x-start[i]),length=Math.hypot(...delta);
 if(length===0)return 0;
 return opticalGaussianRay(kernel,start,delta.map(x=>x/length),0,length)?.integral??0;
}
export function opticalSegmentTransmission(medium,start,end){let tau=0;for(const k of medium.querySegment?.(start,end)??medium)if(k.extinction>0)tau+=k.extinction*opticalGaussianSegment(k,start,end);return Math.exp(-tau);}

// Shared stable normal interval for production slab and segment kernels.
export const OPTICAL_GAUSSIAN_INTERVAL_WGSL=/* wgsl */`
fn opticalErfc(x:f32)->f32{
 let a=abs(x);let t=1.0/(1.0+.5*a);
 let e=t*exp(-a*a-1.26551223+t*(1.00002368+t*(.37409196+t*(.09678418+t*(-.18628806+t*(.27886807+t*(-1.13520398+t*(1.48851587+t*(-.82215223+t*.17087277)))))))));
 return select(e,2.0-e,x<0.0);
}
fn opticalNormalNarrow(center:f32,width:f32)->f32{
 let h=width*.5;let a=h*.3399810435848563;let b=h*.8611363115940526;
 return h*.3989422804014327*(.6521451548625461*(exp(-.5*(center-a)*(center-a))+exp(-.5*(center+a)*(center+a)))+.3478548451374538*(exp(-.5*(center-b)*(center-b))+exp(-.5*(center+b)*(center+b))));
}
fn opticalNormalInterval(lo:f32,hi:f32)->f32{
 if(hi<=lo){return 0.0;}
 if(hi-lo<.5){
  return opticalNormalNarrow((lo+hi)*.5,hi-lo);
 }
 if(lo>=0.0){return max(0.0,.5*(opticalErfc(lo*.7071067811865475)-opticalErfc(hi*.7071067811865475)));}
 if(hi<=0.0){return max(0.0,.5*(opticalErfc(-hi*.7071067811865475)-opticalErfc(-lo*.7071067811865475)));}
 return max(0.0,1.0-.5*(opticalErfc(hi*.7071067811865475)+opticalErfc(-lo*.7071067811865475)));
}
fn opticalNormalSpan(center:f32,width:f32)->f32{
 if(width<=0.0){return 0.0;}if(width<.5){return opticalNormalNarrow(center,width);}
 return opticalNormalInterval(center-width*.5,center+width*.5);
}
`;

// Rows of inverse shape map a world-space vector into unit Gaussian coordinates.
export const OPTICAL_GAUSSIAN_SEGMENT_WGSL=OPTICAL_GAUSSIAN_INTERVAL_WGSL+/* wgsl */`
fn opticalGaussianSegment(start:vec3<f32>,end:vec3<f32>,center:vec3<f32>,inverseShape:mat3x3<f32>,normalization:f32,support:f32)->f32{
 let delta=end-start;let length=length(delta);if(length==0.0){return 0.0;}
 let v=inverseShape*(delta/length);let d=inverseShape*(start-center);let a=dot(v,v);let b=dot(v,d);
 let mean=-b/a;let perpendicular=d+v*mean;let residual=dot(perpendicular,perpendicular);let remaining=support*support-residual;
 if(remaining<=0.0){return 0.0;}
 let radius=sqrt(remaining/a);let lo=max(0.0,mean-radius);let hi=min(length,mean+radius);if(hi<=lo){return 0.0;}
 let scale=sqrt(a);return normalization*exp(-.5*residual)*2.5066282746310002/scale*opticalNormalSpan(((lo+hi)*.5-mean)*scale,(hi-lo)*scale);
}
`;
