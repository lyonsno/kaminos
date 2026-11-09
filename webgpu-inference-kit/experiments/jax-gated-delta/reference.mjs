export function fixture({batch=1, steps=3, heads=1, keys=2, values=3}={}) {
  const dims={batch,steps,heads,keys,values};
  const shapes={q:[batch,steps,heads,keys],k:[batch,steps,heads,keys],
    v:[batch,steps,heads,values],logDecay:[batch,steps,heads],
    beta:[batch,steps,heads],state:[batch,heads,keys,values]};
  const count=s=>s.reduce((a,b)=>a*b,1);
  const data=Object.fromEntries(Object.entries(shapes).map(([name,shape],field)=>[name,
    Array.from({length:count(shape)},(_,i)=>name==='logDecay'?-0.15-0.04*(i%3):
      name==='beta'?0.4+0.1*Math.sin(i+1):0.3*Math.sin(0.7*(i+1)+field))]));
  return {dims,shapes,data};
}
export function reference({dims:d,data:p}) {
  const {batch:B,steps:T,heads:H,keys:K,values:V}=d;
  const s=[...p.state], output=new Array(B*T*H*V).fill(0);
  for(let b=0;b<B;b++)for(let t=0;t<T;t++)for(let h=0;h<H;h++){
    const gate=(b*T+t)*H+h, si=(b*H+h)*K*V;
    for(let k=0;k<K;k++)for(let v=0;v<V;v++)s[si+k*V+v]*=Math.exp(p.logDecay[gate]);
    for(let v=0;v<V;v++){
      let recalled=0;
      for(let k=0;k<K;k++)recalled+=s[si+k*V+v]*p.k[gate*K+k];
      const delta=p.beta[gate]*(p.v[gate*V+v]-recalled);
      for(let k=0;k<K;k++)s[si+k*V+v]+=p.k[gate*K+k]*delta;
    }
    for(let v=0;v<V;v++)for(let k=0;k<K;k++)
      output[gate*V+v]+=p.q[gate*K+k]*s[si+k*V+v];
  }
  return {output,state:s};
}
export function cotangents(f){
  const n=f.dims.batch*f.dims.steps*f.dims.heads*f.dims.values;
  return {output:Array.from({length:n},(_,i)=>0.2+Math.sin(0.4*(i+1))),
    state:Array.from({length:f.data.state.length},(_,i)=>0.1*Math.cos(0.3*i))};
}
export function objective(f) {
  const r=reference(f), c=cotangents(f);
  return r.output.reduce((s,x,i)=>s+x*c.output[i],0)+r.state.reduce((s,x,i)=>s+x*c.state[i],0);
}
export function finiteDifference(f,epsilon=1e-5) {
  const data=Object.fromEntries(Object.entries(f.data).map(([k,v])=>[k,[...v]]));
  return Object.fromEntries(Object.entries(data).map(([name,values])=>[name,values.map((original,i)=>{
    values[i]=original+epsilon;const plus=objective({...f,data});
    values[i]=original-epsilon;const minus=objective({...f,data});
    values[i]=original;
    return (plus-minus)/(2*epsilon);
  })]));
}
export function chunk(f,start,end,state=f.data.state) {
  const {batch:B,steps:T,heads:H}=f.dims;
  const data={state:[...state]}, shapes={state:f.shapes.state};
  for(const name of ['q','k','v','logDecay','beta']){
    const width=f.shapes[name].length===4?f.shapes[name][3]:1;
    data[name]=[];
    for(let b=0;b<B;b++)data[name].push(...f.data[name].slice((b*T+start)*H*width,(b*T+end)*H*width));
    shapes[name]=[B,end-start,H,...(f.shapes[name].length===4?[width]:[])];
  }
  return {dims:{...f.dims,steps:end-start},shapes,data};
}
export function compare(actual,expected,{atol=2e-5,rtol=2e-3}={}) {
  if(actual.length!==expected.length)throw new Error('array length mismatch');
  let maxAbs=0;
  for(let i=0;i<actual.length;i++){
    const error=Math.abs(actual[i]-expected[i]);maxAbs=Math.max(maxAbs,error);
    if(!Number.isFinite(actual[i])||!Number.isFinite(expected[i])||error>atol+rtol*Math.abs(expected[i]))
      throw new Error('numerical mismatch at '+i+': '+actual[i]+' versus '+expected[i]);
  }
  return maxAbs;
}
