// Scalar reference intentionally uses arithmetic digit extraction, not bit ops.
export function q4Fixture({tokens=2,columns=128,rows=5,rank=3,alpha=2}={}) {
  const dims={tokens,columns,rows,rank,groupSize:64,alpha};
  const codes=Array.from({length:rows*columns},(_,i)=>(i*7+Math.floor(i/8)*3)%16);
  const packed=Array.from({length:codes.length/8},(_,i)=>
    codes.slice(i*8,i*8+8).reduce((s,x,j)=>s+x*16**j,0));
  const signal=(n,phase,scale)=>Array.from({length:n},(_,i)=>Math.fround(scale*Math.sin(i*0.19+phase)));
  const groups=rows*columns/64;
  return {dims,base:{packed,scales:signal(groups,1,0.03),biases:signal(groups,2,0.1)},
    params:{input:signal(tokens*columns,3,0.1),a:signal(rank*columns,4,0.05),b:signal(rows*rank,5,0.05)},
    target:signal(tokens*rows,6,0.08)};
}
export function denseWeights(f) {
  const {columns:C,rows:R,groupSize:G}=f.dims,{packed,scales,biases}=f.base;
  return Array.from({length:R*C},(_,i)=>{
    const digit=Math.floor(packed[Math.floor(i/8)]/16**(i%8))%16;
    const group=Math.floor(i/C)*(C/G)+Math.floor((i%C)/G);
    return digit*scales[group]+biases[group];
  });
}
export function q4Reference(f,params=f.params) {
  const {tokens:T,columns:C,rows:R,rank:K,alpha}=f.dims,p=params,w=denseWeights(f),scale=alpha/K;
  const hidden=new Array(T*K).fill(0),base=new Array(T*R).fill(0),output=new Array(T*R).fill(0);
  for(let t=0;t<T;t++)for(let k=0;k<K;k++)for(let c=0;c<C;c++)
    hidden[t*K+k]+=p.input[t*C+c]*p.a[k*C+c];
  for(let t=0;t<T;t++)for(let r=0;r<R;r++){
    for(let c=0;c<C;c++)base[t*R+r]+=p.input[t*C+c]*w[r*C+c];
    output[t*R+r]=base[t*R+r];
    for(let k=0;k<K;k++)output[t*R+r]+=scale*hidden[t*K+k]*p.b[r*K+k];
  }
  let loss=0;
  const grad={input:new Array(T*C).fill(0),a:new Array(K*C).fill(0),b:new Array(R*K).fill(0)};
  for(let t=0;t<T;t++)for(let r=0;r<R;r++){
    const d=(output[t*R+r]-f.target[t*R+r])/(T*R);loss+=(output[t*R+r]-f.target[t*R+r])**2/(2*T*R);
    for(let c=0;c<C;c++)grad.input[t*C+c]+=d*w[r*C+c];
    for(let k=0;k<K;k++){
      grad.b[r*K+k]+=d*scale*hidden[t*K+k];
      for(let c=0;c<C;c++){
        grad.a[k*C+c]+=d*scale*p.input[t*C+c]*p.b[r*K+k];
        grad.input[t*C+c]+=d*scale*p.a[k*C+c]*p.b[r*K+k];
      }
    }
  }
  return {output,base,loss,grad};
}
export function q4FiniteDifference(f,epsilon=1e-5) {
  const p=structuredClone(f.params);
  return Object.fromEntries(Object.entries(p).map(([name,values])=>[name,values.map((v,i)=>{
    values[i]=v+epsilon;const plus=q4Reference(f,p).loss;
    values[i]=v-epsilon;const minus=q4Reference(f,p).loss;
    values[i]=v;return (plus-minus)/(2*epsilon);
  })]));
}
