// Source equations: NVlabs/neuralappearance@305b4b9c12e679398c487603dd8245c3f348526c,
// util/math_helpers.slang, datagen/data_generator.slang and losses/l1_with_power_log.slang.
// UniformRusinkiewicz is an explicitly supported author strategy, distinct from
// the default mixture that additionally requires reference-material sampling.
export function uniformRusinkiewicz(u){
 if(!Array.isArray(u)||u.length!==4||!u.every(x=>Number.isFinite(x)&&x>=0&&x<1))throw Error('Four uniform samples in [0,1) required');
 const [th,td,ph,pd]=[u[0]*Math.PI/2,u[1]*Math.PI/2,u[2]*Math.PI*2,u[3]*Math.PI*2];
 const d=[Math.cos(pd)*Math.sin(td),Math.sin(pd)*Math.sin(td),Math.cos(td)];
 const rotated=[Math.cos(th)*d[0]+Math.sin(th)*d[2],d[1],-Math.sin(th)*d[0]+Math.cos(th)*d[2]];
 const wi=[Math.cos(ph)*rotated[0]-Math.sin(ph)*rotated[1],Math.sin(ph)*rotated[0]+Math.cos(ph)*rotated[1],rotated[2]];
 const h=[Math.cos(ph)*Math.sin(th),Math.sin(ph)*Math.sin(th),Math.cos(th)],dot=wi.reduce((s,x,i)=>s+x*h[i],0),reflected=h.map((x,i)=>2*dot*x-wi[i]),length=Math.hypot(...reflected),wo=reflected.map(x=>x/length);
 return {wi,wo,valid:wi[2]>=1e-3&&wo[2]>=0};
}
export function publishedPowerLogLoss(predicted,reference,power=3){
 if(!Number.isFinite(power)||power<=0||!predicted.length||predicted.length!==reference.length||![...predicted,...reference].every(x=>Number.isFinite(x)&&x>=0))throw Error('Equal finite nonnegative response arrays and positive power required');
 return predicted.reduce((sum,x,i)=>sum+power*Math.abs(x**(1/power)-reference[i]**(1/power)),0)/predicted.length;
}
export function cosineLearningRate(iteration,iterations,{initial=.001,endScale=.01}={}){
 if(!Number.isFinite(iteration)||iteration<0||!Number.isSafeInteger(iterations)||iterations<=0||!Number.isFinite(initial)||initial<=0||!Number.isFinite(endScale)||endScale<0)throw Error('Valid cosine training schedule required');
 const t=Math.min(iteration/iterations,1);return initial*(endScale+(1-endScale)*.5*(1+Math.cos(Math.PI*t)));
}
const coordinateStorage=new ArrayBuffer(4),coordinateFloat=new Float32Array(coordinateStorage),coordinateBits=new Uint32Array(coordinateStorage);
function stratumCoordinate(value,lower,upper){coordinateFloat[0]=value;if(coordinateFloat[0]>=upper)coordinateBits[0]--;else if(coordinateFloat[0]<lower)coordinateBits[0]++;return coordinateFloat[0];}
export function publishedQueryBatch(count,random,{batchSize=count,resolution,snapToTexelCenter=false}={}){
 const side=Math.sqrt(batchSize);
 if(!Number.isSafeInteger(count)||count<=0||!Number.isSafeInteger(side)||count%batchSize)throw Error('Whole square-stratified batches required');
 if(snapToTexelCenter&&(!Number.isSafeInteger(resolution)||resolution<1))throw Error('Positive latent resolution required for snapped queries');
 const next=()=>{const x=random();if(!Number.isFinite(x)||x<0||x>=1)throw Error('Uniform random value required');return x;};
 const queries=new Float32Array(count*8);
 for(let i=0;i<count;i++){
  const j=i*8,cell=i%batchSize;const x=cell%side,y=Math.floor(cell/side);queries[j]=stratumCoordinate((x+next())/side,x/side,(x+1)/side);queries[j+1]=stratumCoordinate((y+next())/side,y/side,(y+1)/side);
  if(snapToTexelCenter){queries[j]=(Math.min(resolution-1,Math.floor(queries[j]*resolution))+.5)/resolution;queries[j+1]=(Math.min(resolution-1,Math.floor(queries[j+1]*resolution))+.5)/resolution;}
  let d;for(let attempt=0;attempt<100;attempt++){d=uniformRusinkiewicz([next(),next(),next(),next()]);if(d.valid)break;}
  // Same validity-attempt bound as the author. Do not label failed samples or
  // silently replace them with a different distribution.
  if(!d.valid)throw Error('Published directional sampler exhausted its validity attempts');
  queries.set(d.wi,j+2);queries.set(d.wo,j+5);
 }
 return queries;
}
