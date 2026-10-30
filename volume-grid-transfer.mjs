// Regular grids share physical bounds, not necessarily cell boundaries.
export function latticeDimensions(dims,width,label='Grid') {
 if(!Number.isSafeInteger(width)||width<2)throw Error(`${label} width must be an integer of at least 2 cells`);
 const result=dims.map(n=>n*width/dims[0]);
 if(result.some(n=>!Number.isSafeInteger(Math.round(n))||Math.abs(n-Math.round(n))>1e-8))throw Error(`${label} height must tile the physical box with cubic cells`);
 return result.map(Math.round);
}
export function cellOverlaps(source,target,cell) {
 const ratio=source/target,lo=cell*source/target,hi=(cell+1)*source/target,rows=[];
 for(let i=Math.floor(lo);i<Math.min(source,Math.ceil(hi));i++){
  const weight=Math.max(0,Math.min(hi,i+1)-Math.max(lo,i))/ratio;
  if(weight>0)rows.push({index:i,weight});
 }
 return rows;
}
export function transferWork(source,target) {
 const gcd=(a,b)=>b?gcd(b,a%b):a;
 const sourceCells=source.reduce((a,b)=>a*b,1),targetCells=target.reduce((a,b)=>a*b,1);
 const volumeSamples=source.reduce((n,s,i)=>n*(s+target[i]-gcd(s,target[i])),1);
 return {sourceCells,targetCells,volumeSamples,samplesPerTarget:volumeSamples/targetCells,
  samplesPerLargerGrid:volumeSamples/Math.max(sourceCells,targetCells),
  method:source.every((n,i)=>n%target[i]===0)?'aligned-block':'overlap-weighted'};
}
export const TRANSFER_GEOMETRY_WGSL=/* wgsl */`
fn transferBegin(c:vec3<u32>,source:vec3<u32>,destination:vec3<u32>)->vec3<i32>{return vec3<i32>(c*source/destination);}
fn transferEnd(c:vec3<u32>,source:vec3<u32>,destination:vec3<u32>)->vec3<i32>{return vec3<i32>(((c+1u)*source+destination-1u)/destination);}
fn transferLo(c:vec3<u32>,source:vec3<u32>,destination:vec3<u32>)->vec3<f32>{return vec3<f32>(c*source)/vec3<f32>(destination);}
fn transferHi(c:vec3<u32>,source:vec3<u32>,destination:vec3<u32>)->vec3<f32>{return vec3<f32>((c+1u)*source)/vec3<f32>(destination);}
fn transferOverlap(c:vec3<i32>,lo:vec3<f32>,hi:vec3<f32>)->vec3<f32>{
 let p=vec3<f32>(c);return max(vec3<f32>(0),min(p+1.0,hi)-max(p,lo));
}
`;
