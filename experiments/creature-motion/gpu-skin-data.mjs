// Static all-influence payload. No top-K reduction, weight threshold or topology
// approximation: face lists retain the CPU normal accumulator's triangle order.
export function prepareGpuSkin({rest,triangles,weights,channels}){
 const n=rest.length/3;
 if(!Number.isInteger(n)||n<1||!Number.isInteger(channels)||channels<1||weights.length!==n*channels||triangles.length%3)throw Error('Incomplete GPU skin arrays');
 if(!rest.every(Number.isFinite))throw Error('Invalid GPU rest geometry');
 const dominant=new Uint32Array(n),offsets=new Uint32Array(n+1);
 for(let v=0;v<n;v++){
  let total=0,best=0;
  for(let j=0;j<channels;j++){const w=weights[v*channels+j];if(!Number.isFinite(w)||w<0)throw Error('Invalid GPU transport influence');total+=w;if(w>weights[v*channels+best])best=j;}
  if(Math.abs(total-1)>1e-5)throw Error('Incomplete GPU transport partition');dominant[v]=best;
 }
 for(const index of triangles){if(!Number.isInteger(index)||index<0||index>=n)throw Error('Invalid GPU triangle index');offsets[index+1]++;}
 for(let v=1;v<=n;v++)offsets[v]+=offsets[v-1];
 const faces=new Uint32Array(triangles.length),cursor=offsets.slice();
 for(let f=0;f<triangles.length/3;f++)for(let c=0;c<3;c++)faces[cursor[triangles[f*3+c]]++]=f;
 return {rest:rest.slice(),triangles:triangles.slice(),weights:weights.slice(),dominant,offsets,faces,vertices:n,channels};
}
