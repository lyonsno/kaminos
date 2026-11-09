import {numpy as np} from '@jax-js/jax';

// Q/K are prepared inputs (including any caller-owned normalization/scaling).
// logDecay is logarithmic; beta is the already prepared update strength.
// Consumes every input array once on success, returns owned output/state arrays.
// Shape rejection occurs before input consumption. The time loop is unrolled
// by jit; this is a numerical/integration prototype, not a fused recurrence.
export function gatedDeltaSequence(p) {
  const [B,T,H,K]=p.q.shape, V=p.v.shape[3];
  const equal=(actual,expected)=>actual.length===expected.length&&actual.every((x,i)=>x===expected[i]);
  if(p.q.shape.length!==4||![B,H,K,V].every(x=>Number.isSafeInteger(x)&&x>0)||!Number.isSafeInteger(T)||T<0)
    throw new Error('invalid recurrence dimensions');
  for(const [name,shape]of Object.entries({k:[B,T,H,K],v:[B,T,H,V],logDecay:[B,T,H],beta:[B,T,H],state:[B,H,K,V]}))
    if(!equal(p[name].shape,shape))throw new Error('invalid '+name+' shape');
  let state=p.state;
  const outputs=[];
  for(let t=0;t<T;t++){
    const q=p.q.ref.slice([],t),k=p.k.ref.slice([],t),v=p.v.ref.slice([],t);
    const decay=np.exp(p.logDecay.ref.slice([],t)).reshape([B,H,1,1]);
    const beta=p.beta.ref.slice([],t).reshape([B,H,1]);
    const decayed=state.mul(decay);
    const recalled=decayed.ref.mul(k.ref.reshape([B,H,K,1])).sum(-2);
    const update=v.sub(recalled).mul(beta).reshape([B,H,1,V]);
    state=decayed.add(k.reshape([B,H,K,1]).mul(update));
    outputs.push(state.ref.mul(q.reshape([B,H,K,1])).sum(-2));
  }
  for(const name of ['q','k','v','logDecay','beta'])p[name].dispose();
  return {output:T?np.stack(outputs,1):np.zeros([B,0,H,V]),state};
}
