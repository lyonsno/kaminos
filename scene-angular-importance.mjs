// A fixed, cached directional bank; history selects fresh current-state rays.
// The estimator targets the bank's uniform mean, not continuous angular truth.
export function importanceDistribution(scores){
  if(!scores.length||scores.some(v=>!Number.isFinite(v)||v<0))throw Error('finite nonnegative importance scores required');
  const scale=scores.reduce((a,b)=>Math.max(a,b),0),scaled=scores.map(v=>scale?v/scale:0),sum=scaled.reduce((a,b)=>a+b,0);
  return scaled.map(v=>sum?.25/scores.length+.75*v/sum:1/scores.length);
}
export function importanceSelect(q,u){let sum=0;for(let i=0;i<q.length;i++){sum+=q[i];if(u<sum)return i;}return q.length-1;}
export function importanceWeight(q,count,bank){return 1/(q*count*bank);}
export const ANGULAR_IMPORTANCE_WGSL=/* wgsl */`
@group(0) @binding(20) var<storage,read_write> importanceScores:array<f32>;
@group(0) @binding(21) var<storage,read_write> importanceCdf:array<f32>;
@compute @workgroup_size(64)
fn prepareImportance(@builtin(global_invocation_id) global:vec3<u32>){
 let receiver=global.x+global.y*DISPATCH_WIDTH;if(receiver>=RECEIVER_COUNT){return;}
 let start=receiver*DIRECTION_COUNT;var scale=0.0;
 for(var a=0u;a<DIRECTION_COUNT;a++){scale=max(scale,importanceScores[start+a]);}
 var sum=0.0;
 if(scale>0.0){for(var a=0u;a<DIRECTION_COUNT;a++){sum+=importanceScores[start+a]/scale;}}
 var cdf=0.0;
 for(var a=0u;a<DIRECTION_COUNT;a++){
  var q=1.0/f32(DIRECTION_COUNT);
  if(sum>0.0){q=0.25/f32(DIRECTION_COUNT)+0.75*(importanceScores[start+a]/scale)/sum;}
  cdf+=q;importanceCdf[start+a]=select(cdf,1.0,a==DIRECTION_COUNT-1u);
  importanceScores[start+a]*=0.98;
 }
}
fn selectImportance(receiver:u32,u:f32)->u32{
 let start=receiver*DIRECTION_COUNT;var lo=0u;var hi=DIRECTION_COUNT-1u;
 loop {if(lo>=hi){break;}let mid=(lo+hi)/2u;if(u<importanceCdf[start+mid]){hi=mid;}else{lo=mid+1u;}}
 return lo;
}
fn importanceProbability(receiver:u32,a:u32)->f32{
 let start=receiver*DIRECTION_COUNT;var before=0.0;if(a>0u){before=importanceCdf[start+a-1u];}
 return importanceCdf[start+a]-before;
}
fn recordImportance(receiver:u32,a:u32,radiance:vec3<f32>){
 let index=receiver*DIRECTION_COUNT+a;
 // Scores are a proposal heuristic, never returned radiance or a cached estimate.
 let score=dot(min(max(radiance,vec3<f32>(0)),vec3<f32>(1e30)),vec3<f32>(0.2126,0.7152,0.0722));
 importanceScores[index]=mix(importanceScores[index],score,0.25);
}
`;
