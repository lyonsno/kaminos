// Optical sequence reconstruction. Positions and velocities use the recorded
// volume's physical coordinates; time is the recorded simulation-step clock.
export function validateOpticalFrame(frame) {
  const {dimensions:d, bounds:b, optical:q, velocity:v, time} = frame ?? {};
  if (!Array.isArray(d) || d.length!==3 || !d.every(n=>Number.isSafeInteger(n)&&n>0)
    || !Array.isArray(b) || b.length!==2 || !b.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))
    || b[1].some((x,a)=>x<=b[0][a]) || !Number.isFinite(time)) throw Error('Optical frame needs dimensions, physical bounds and finite time');
  const n=d.reduce((a,x)=>a*x,1);
  if (!(q instanceof Float32Array) || q.length!==n*4 || !q.every(x=>Number.isFinite(x)&&x>=0)) throw Error('Complete nonnegative emission RGB/extinction required');
  if (!(v instanceof Float32Array) || v.length!==n*3 || !v.every(Number.isFinite)) throw Error('Complete physical velocity required');
  return frame;
}

function stencil(position, dimensions, bounds) {
  if (position.some((x,a)=>x<bounds[0][a]||x>bounds[1][a])) return [];
  const q=position.map((x,a)=>(x-bounds[0][a])/(bounds[1][a]-bounds[0][a])*dimensions[a]-.5),base=q.map(Math.floor),f=q.map((x,a)=>x-base[a]),out=[];
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
    const off=[x,y,z],c=base.map((n,a)=>Math.max(0,Math.min(dimensions[a]-1,n+off[a])));
    out.push([c[0]+dimensions[0]*(c[1]+dimensions[1]*c[2]),off.reduce((w,n,a)=>w*(n?f[a]:1-f[a]),1)]);
  }
  return out;
}
function center(id,d,b){const c=[id%d[0],Math.floor(id/d[0])%d[1],Math.floor(id/(d[0]*d[1]))];return c.map((n,a)=>b[0][a]+(n+.5)*(b[1][a]-b[0][a])/d[a]);}
export function sampleOptical(frame, position) {
  const value=[0,0,0,0];for(const [id,w] of stencil(position,frame.dimensions,frame.bounds))for(let c=0;c<4;c++)value[c]+=frame.optical[id*4+c]*w;return value;
}
export function resampleOptical(frame, dimensions) {
  validateOpticalFrame(frame);
  if(!Array.isArray(dimensions)||dimensions.length!==3||!dimensions.every(n=>Number.isSafeInteger(n)&&n>0))throw Error('Positive integer output dimensions required');
  const n=dimensions.reduce((a,x)=>a*x,1),optical=new Float32Array(n*4),velocity=new Float32Array(n*3);
  for(let i=0;i<n;i++){const p=center(i,dimensions,frame.bounds);optical.set(sampleOptical(frame,p),i*4);for(const [id,w]of stencil(p,frame.dimensions,frame.bounds))for(let c=0;c<3;c++)velocity[i*3+c]+=frame.velocity[id*3+c]*w;}
  return {...frame,dimensions:[...dimensions],optical,velocity};
}
export function restrictOptical(frame, dimensions) {
  validateOpticalFrame(frame);
  const scale=frame.dimensions.map((n,a)=>n/dimensions[a]);
  if(!scale.every(n=>Number.isSafeInteger(n)&&n>=1))throw Error('Restriction requires whole source cells per destination cell');
  const result=resampleOptical(frame,dimensions);result.optical.fill(0);result.velocity.fill(0);
  const n=scale.reduce((a,x)=>a*x,1),d=frame.dimensions;
  for(let z=0;z<d[2];z++)for(let y=0;y<d[1];y++)for(let x=0;x<d[0];x++){
    const source=x+d[0]*(y+d[1]*z),target=Math.floor(x/scale[0])+dimensions[0]*(Math.floor(y/scale[1])+dimensions[1]*Math.floor(z/scale[2]));
    for(let c=0;c<4;c++)result.optical[target*4+c]+=frame.optical[source*4+c]/n;
    for(let c=0;c<3;c++)result.velocity[target*3+c]+=frame.velocity[source*3+c]/n;
  }
  return result;
}

function velocityAt(frame,p){const v=[0,0,0];for(const [i,w]of stencil(p,frame.dimensions,frame.bounds))for(let a=0;a<3;a++)v[a]+=frame.velocity[i*3+a]*w;return v;}
function trace(frames,from,to,point){
 let p=point.slice();
 for(let k=from;k!==to;){const next=k+Math.sign(to-k),dt=frames[next].time-frames[k].time,v=velocityAt(frames[k],p),mid=p.map((x,a)=>x+v[a]*dt*.5),a=velocityAt(frames[k],mid),b=velocityAt(frames[next],mid);p=p.map((x,c)=>x+(a[c]+b[c])*.5*dt);k=next;}
 return p;
}
function children(d,c,visit){
 const scale=d.map((n,a)=>n/c[a]);if(!scale.every(n=>Number.isSafeInteger(n)&&n>=1))throw Error('Reconstruction dimensions must refine each coarse axis by whole cells');
 for(let z=0;z<d[2];z++)for(let y=0;y<d[1];y++)for(let x=0;x<d[0];x++)visit(x+d[0]*(y+d[1]*z),Math.floor(x/scale[0])+c[0]*(Math.floor(y/scale[1])+c[1]*Math.floor(z/scale[2])),1/scale.reduce((a,n)=>a*n,1));
}
function constrainCurrent(values,frame,d){
 const counts=new Uint32Array(frame.optical.length/4),sums=new Float64Array(frame.optical.length);
 children(d,frame.dimensions,(i,j)=>{counts[j]++;for(let c=0;c<4;c++)sums[j*4+c]+=values[i*4+c];});
 children(d,frame.dimensions,(i,j)=>{for(let c=0;c<4;c++){const target=frame.optical[j*4+c],sum=sums[j*4+c];values[i*4+c]=target===0?0:sum>0?values[i*4+c]*target*counts[j]/sum:target;}});
}
function observationOperator(frames,centerIndex,observedIndex,d){
 const source=frames[observedIndex],rows=Array.from({length:source.optical.length/4},()=>new Map());
 children(d,source.dimensions,(i,j,volumeWeight)=>{
  const p=trace(frames,observedIndex,centerIndex,center(i,d,source.bounds));
  for(const [id,w]of stencil(p,d,source.bounds))rows[j].set(id,(rows[j].get(id)??0)+w*volumeWeight);
 });
 return rows.map((row,j)=>{const ids=Uint32Array.from(row.keys()),weights=Float32Array.from(row.values());return {j,ids,weights,diagonal:weights.reduce((s,w)=>s+w*w,0)};});
}
const totals=q=>{const t=[0,0,0,0];for(let i=0;i<q.length;i++)t[i%4]+=q[i];return t;};

export function reconstructOpticalFrame(frames,index,{dimensions=frames[index]?.dimensions,mode='future',radius=2,iterations=8,relaxation=.3,previous=null}={}) {
  for(const frame of frames)validateOpticalFrame(frame);
  if(!Number.isSafeInteger(index)||!frames[index]||!['single','forward','future'].includes(mode))throw Error('Valid current frame and reconstruction mode required');
  if(!Number.isSafeInteger(radius)||radius<0||!Number.isSafeInteger(iterations)||iterations<0||!Number.isFinite(relaxation)||relaxation<=0||relaxation>1)throw Error('Nonnegative window/iterations and relaxation in (0,1] required');
  if(frames.some((f,i)=>JSON.stringify(f.dimensions)!==JSON.stringify(frames[index].dimensions)||JSON.stringify(f.bounds)!==JSON.stringify(frames[index].bounds)||(i&&f.time<=frames[i-1].time)))throw Error('Sequence requires shared dimensions/bounds and strictly increasing time');
  const result=resampleOptical(frames[index],dimensions);
  if(previous&&mode!=='single'){
   validateOpticalFrame(previous);const priorIndex=frames.findIndex(f=>f.time===previous.time);
   if(priorIndex<0||priorIndex>=index)throw Error('Previous reconstruction must precede the current frame in this sequence');
   if(JSON.stringify(previous.bounds)!==JSON.stringify(result.bounds))throw Error('Previous reconstruction bounds must match the sequence');
   for(let i=0;i<result.optical.length/4;i++)result.optical.set(sampleOptical(previous,trace(frames,index,priorIndex,center(i,dimensions,result.bounds))),i*4);
  }
  constrainCurrent(result.optical,frames[index],dimensions);
  const first=mode==='single'?index:Math.max(0,index-radius),last=mode==='future'?Math.min(frames.length-1,index+radius):index;
  const currentTotals=totals(frames[index].optical),observations=[];
  for(let t=first;t<=last;t++)if(t!==index){
   const sum=totals(frames[t].optical),gain=sum.map((v,c)=>currentTotals[c]>0?v/currentTotals[c]:0);
   observations.push({index:t,rows:observationOperator(frames,index,t,dimensions),gain});
  }
  for(let pass=0;pass<iterations&&observations.length;pass++){
   for(const observation of observations){const target=frames[observation.index].optical;
    for(const row of observation.rows){if(row.diagonal<1e-14)continue;
     for(let c=0;c<4;c++){
      const gain=observation.gain[c];if(gain<=1e-12)continue;
      let prediction=0;for(let k=0;k<row.ids.length;k++)prediction+=row.weights[k]*result.optical[row.ids[k]*4+c];
      const correction=relaxation*(target[row.j*4+c]/gain-prediction)/row.diagonal/observations.length;
      for(let k=0;k<row.ids.length;k++){const address=row.ids[k]*4+c;result.optical[address]=Math.max(0,result.optical[address]+correction*row.weights[k]);}
     }
    }
   }
   constrainCurrent(result.optical,frames[index],dimensions);
  }
  return {...result,reconstruction:{mode,index,radius,iterations,relaxation,observedFrames:observations.map(o=>o.index),seed:previous&&mode!=='single'?'advected-previous':'current-linear',materialEvolution:'global-channel-power-normalization; local reactions remain fit residual',currentCoarseTotals:'constrained-positive-block-means'}};
}
