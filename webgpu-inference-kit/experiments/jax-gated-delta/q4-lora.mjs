import {numpy as np} from '@jax-js/jax';

// Frozen packed weights are separate from the differentiated parameter tree.
// This correctness baseline expresses dequantization then matmul in jax;
// it makes no assertion about fusion or model-scale weight/activation memory.
// Both argument trees are consumed on success. Validation precedes consumption.
export function createQ4LoraProjection(layout) {
  const {columns:C,rows:R,rank:K,groupSize:G=64,alpha=K}=layout;
  if(![C,R,K,G].every(x=>Number.isSafeInteger(x)&&x>0)||G!==64||C%G||!Number.isFinite(alpha))
    throw new Error('invalid affine4/group64 LoRA layout');
  return (p,base)=>{
    const T=p?.input?.shape?.[0];
    const shapes={input:[T,C],a:[K,C],b:[R,K],packed:[R,C/8],scales:[R,C/G],biases:[R,C/G]};
    if(!Number.isSafeInteger(T)||T<1)throw new Error('invalid token dimension');
    for(const [name,shape]of Object.entries(shapes)){
      const a=['input','a','b'].includes(name)?p?.[name]:base?.[name];
      if(!a||a.shape.length!==shape.length||a.shape.some((x,i)=>x!==shape[i]))throw new Error('invalid '+name+' shape');
      if(a.dtype!==(name==='packed'?np.uint32:np.float32))throw new Error('invalid '+name+' dtype');
    }
    const shifts=np.array(new Uint32Array([0,4,8,12,16,20,24,28]));
    const codes=np.bitwiseAnd(np.rightShift(base.packed.reshape([R,C/8,1]),shifts),np.array(new Uint32Array([15])))
      .astype(np.float32).reshape([R,C/G,G]);
    const weight=codes.mul(base.scales.reshape([R,C/G,1])).add(base.biases.reshape([R,C/G,1])).reshape([R,C]);
    const y=np.matmul(p.input.ref,weight.transpose());
    const hidden=np.matmul(p.input,p.a.transpose());
    return y.add(np.matmul(hidden,p.b.transpose()).mul(alpha/K));
  };
}
