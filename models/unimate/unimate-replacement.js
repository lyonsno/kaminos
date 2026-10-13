// Upstream UniMate replacement-style fixed-step Euler, separate from dopri5.
export async function replacementSolve({noise,known,mask,drift,steps=50,t0=0,t1=1,times=null,onStep}) {
 if(!Number.isInteger(steps)||steps<=0||!Number.isFinite(t0)||!Number.isFinite(t1)||t1<=t0)throw new RangeError('invalid integration interval');
 if(!noise?.length||known?.length!==noise.length||mask?.length!==noise.length)throw new RangeError('constraint shape mismatch');
 if(!noise.every(Number.isFinite)||!known.every(Number.isFinite)||!mask.every(v=>v===0||v===1))throw new Error('nonfinite or invalid constraint');
 let x=Float32Array.from(noise);
 // torch.linspace uses a float32 step and fills from opposite ends.
 const step=Math.fround((Math.fround(t1)-Math.fround(t0))/steps);
 const ts=times??Array.from({length:steps+1},(_,i)=>Math.fround(i<=(steps+1)/2?Math.fround(t0)+step*i:Math.fround(t1)-step*(steps-i)));
 if(ts.length!==steps+1||ts[0]!==Math.fround(t0)||ts.at(-1)!==Math.fround(t1)||ts.some((t,i)=>!Number.isFinite(t)||(i>0&&t<=ts[i-1])))throw new RangeError('invalid integration times');
 const pin=t=>{for(let i=0;i<x.length;i++)if(mask[i])x[i]=Math.fround(Math.fround(Math.fround(1-t)*noise[i])+Math.fround(t*known[i]));};
 pin(ts[0]);
 for(let s=0;s<steps;s++){
  const v=await drift(ts[s],x),dt=Math.fround(ts[s+1]-ts[s]);
  if(v?.length!==x.length||!v.every(Number.isFinite))throw new Error('partial or nonfinite drift');
  x=Float32Array.from(x,(y,i)=>Math.fround(y+Math.fround(dt*v[i])));
  pin(ts[s+1]);
  onStep?.({step:s+1,t:ts[s+1]});
 }
 return x;
}

const ident=()=>[1,0,0,0,1,0,0,0,1];
function matrix(v){
 const norm=a=>{const n=Math.hypot(...a);return a.map(x=>x/n);}, cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const x=norm(v.slice(0,3)),z=norm(cross(x,v.slice(3,6))),y=cross(z,x),m=[x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]];
 return m.every(Number.isFinite)?m:ident();
}
const transpose=m=>[m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];
const mul=(a,b)=>Array.from({length:9},(_,i)=>[0,1,2].reduce((s,k)=>s+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0));
const six=m=>[m[0],m[3],m[6],m[1],m[4],m[7]];

// Normalized [J,12,T] state. Re-express only facing/root-child rotations;
// local RIFKE position/velocity and constant-normalization channels stay intact.
export function alignOverlap({state,parents,mean,std,frames,inverse=false,facing=null}) {
 const J=parents.length,T=frames,at=(j,d,t)=>(j*12+d)*T+t;
 if(state.length!==J*12*T||mean.length!==J*12||std.length!==J*12)throw new RangeError('rotation shape mismatch');
 const values=(j,t)=>[3,4,5,6,7,8].map(d=>state[at(j,d,t)]*std[j*12+d]+mean[j*12+d]);
 const originalFacing=facing??matrix(values(0,0)),q=inverse?transpose(originalFacing):originalFacing,out=Float32Array.from(state);
 for(let t=0;t<T;t++)for(let j=0;j<J;j++)if(j===0||parents[j]===0){
  const r=matrix(values(j,t)),v=six(j===0?mul(r,transpose(q)):mul(q,r));
  for(let c=0;c<6;c++){const d=c+3;if(std[j*12+d]>=1e-6)out[at(j,d,t)]=(v[c]-mean[j*12+d])/std[j*12+d];}
 }
 return {state:out,facing:originalFacing};
}

export function tailConstraint(state,joints,frames,overlap){
 if(!Number.isInteger(overlap)||overlap<=0||overlap>=frames||state.length!==joints*12*frames)throw new RangeError('invalid overlap');
 const tail=new Float32Array(joints*12*overlap);
 for(let jd=0;jd<joints*12;jd++)tail.set(state.subarray(jd*frames+frames-overlap,(jd+1)*frames),jd*overlap);
 return tail;
}

export function seedConstraint(tail,joints,frames,overlap){
 if(tail.length!==joints*12*overlap||!Number.isInteger(overlap)||overlap<=0||overlap>=frames)throw new RangeError('invalid overlap');
 const known=new Float32Array(joints*12*frames),mask=new Uint8Array(known.length);
 for(let jd=0;jd<joints*12;jd++){known.set(tail.subarray(jd*overlap,(jd+1)*overlap),jd*frames);mask.fill(1,jd*frames,jd*frames+overlap);}
 return {known,mask};
}
