import {createQ4LoraProjection} from './q4-lora.mjs';
import {q4Fixture,q4Reference} from './q4-reference.mjs';
import {compare} from './reference.mjs';

export function q4Arrays(jax,f) {
  const np=jax.numpy,{tokens:T,columns:C,rows:R,rank:K,groupSize:G}=f.dims;
  const shapes={input:[T,C],a:[K,C],b:[R,K],packed:[R,C/8],scales:[R,C/G],biases:[R,C/G]};
  const convert=(name,v)=>np.array(name==='packed'?new Uint32Array(v):new Float32Array(v)).reshape(shapes[name]);
  return {params:Object.fromEntries(Object.entries(f.params).map(([k,v])=>[k,convert(k,v)])),
    base:Object.fromEntries(Object.entries(f.base).map(([k,v])=>[k,convert(k,v)]))};
}
export function q4Loss(jax,f,projection=createQ4LoraProjection(f.dims)) {
  return (p,base)=>jax.numpy.square(projection(p,base).sub(jax.numpy.array(new Float32Array(f.target)).reshape([f.dims.tokens,f.dims.rows]))).sum().mul(0.5/f.target.length);
}
async function read(a,backend) {
  if(a.device!==backend)throw new Error('wrong effective backend '+a.device);
  return Array.from(await a.data());
}
export async function runQ4Case(jax,backend,f=q4Fixture()) {
  jax.defaultDevice(backend);
  const projection=createQ4LoraProjection(f.dims),forward=jax.jit(projection),backward=jax.jit(jax.valueAndGrad(q4Loss(jax,f,projection)));
  try{
    let x=q4Arrays(jax,f);
    const output=await read(forward(x.params,x.base),backend);
    x=q4Arrays(jax,f);
    const [value,gradient]=backward(x.params,x.base);
    const loss=(await read(value,backend))[0],grad={};
    for(const [name,g]of Object.entries(gradient))grad[name]=await read(g,backend);
    const expected=q4Reference(f),errors={output:compare(output,expected.output),loss:compare([loss],[expected.loss])};
    for(const [name,g]of Object.entries(grad))errors[name]=compare(g,expected.grad[name]);
    return {caseName:'q4-lora',dims:f.dims,backend,output,loss,grad,errors};
  }finally{forward.dispose();backward.dispose();}
}

export async function runQ4Update(jax,backend,f=q4Fixture(),learningRate=1,onUpdated=async()=>null) {
  if(!Number.isFinite(learningRate)||learningRate<=0)throw new Error('invalid learning rate');
  jax.defaultDevice(backend);
  const loss=q4Loss(jax,f),gradient=jax.valueAndGrad(loss);
  const step=jax.jit((p,base)=>{
    const [value,g]=gradient(jax.tree.map(a=>a.ref,p),base);
    g.input.dispose();
    return {value,input:p.input,a:p.a.sub(g.a.mul(learningRate)),b:p.b.sub(g.b.mul(learningRate))};
  }),evaluate=jax.jit(loss);
  let updated,frozen;
  try{
    const x=q4Arrays(jax,f);frozen=x.base;
    const out=step(x.params,jax.tree.map(a=>a.ref,frozen));
    const beforeLoss=(await read(out.value,backend))[0];
    updated={input:out.input,a:out.a,b:out.b};
    const params={};for(const [name,a]of Object.entries(updated))params[name]=await read(a.ref,backend);
    const expected=q4Reference(f),next=structuredClone(f.params),errors={};
    for(const name of ['a','b']){
      next[name]=next[name].map((v,i)=>v-learningRate*expected.grad[name][i]);
      errors[name]=compare(params[name],next[name]);
      if(params[name].every((v,i)=>v===f.params[name][i]))throw new Error('adapter '+name+' did not change');
    }
    compare(params.input,f.params.input,{atol:0,rtol:0});
    const afterLoss=(await read(evaluate(jax.tree.map(a=>a.ref,updated),jax.tree.map(a=>a.ref,frozen)),backend))[0];
    compare([beforeLoss],[expected.loss]);compare([afterLoss],[q4Reference(f,next).loss]);
    if(!(afterLoss<beforeLoss))throw new Error('SGD step did not lower loss');
    const handoff=await onUpdated(updated,frozen);
    return {caseName:'q4-lora-update',dims:f.dims,backend,learningRate,beforeLoss,afterLoss,params,errors,handoff};
  }finally{if(updated)jax.tree.dispose(updated);if(frozen)jax.tree.dispose(frozen);step.dispose();evaluate.dispose();}
}
