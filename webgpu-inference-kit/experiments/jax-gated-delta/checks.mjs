import {gatedDeltaSequence} from './recurrence.mjs';
import {fixture,reference,cotangents,finiteDifference,chunk,compare} from './reference.mjs';
export function arrays(jax,f) {
  return Object.fromEntries(Object.entries(f.data).map(([name,v])=>[name,jax.numpy.array(new Float32Array(v)).reshape(f.shapes[name])]));
}
export function lossFunction(jax,f) {
  const c=cotangents(f),np=jax.numpy;
  return p=>{
    const result=gatedDeltaSequence(p);
    return result.output.mul(np.array(new Float32Array(c.output)).reshape([f.dims.batch,f.dims.steps,f.dims.heads,f.dims.values])).sum()
      .add(result.state.mul(np.array(new Float32Array(c.state)).reshape(f.shapes.state)).sum());
  };
}
async function readTree(jax,tree,backend) {
  const records=Object.fromEntries(Object.entries(tree).map(([name,a])=>[name,{shape:[...a.shape],device:a.device}]));
  for(const a of Object.values(records))if(a.device!==backend)throw new Error('wrong effective backend: '+a.device);
  const values={};
  for(const [name,a] of Object.entries(tree))values[name]=Array.from(await a.data());
  return {records,values};
}
export async function runNumericalChecks(jax,backend,onCase=async()=>{}) {
  jax.defaultDevice(backend);
  const results=[];
  for(const dims of [{},{batch:2,steps:4,heads:2,keys:3,values:2}]){
    const f=fixture(dims),run=jax.jit(gatedDeltaSequence);
    try {
      const observed=await readTree(jax,run(arrays(jax,f)),backend),expected=reference(f);
      const record={caseName:'forward',dims:f.dims,...observed,
        errors:{output:compare(observed.values.output,expected.output),state:compare(observed.values.state,expected.state)}};
      results.push(record);await onCase(record);
    }finally{run.dispose();}
  }
  const f=fixture(),run=jax.jit(jax.valueAndGrad(lossFunction(jax,f)));
  try {
    const [loss,gradient]=run(arrays(jax,f));
    if(loss.device!==backend)throw new Error('wrong loss backend');
    const lossValue=Array.from(await loss.data())[0], observed=await readTree(jax,gradient,backend);
    const expected=finiteDifference(f),errors={};
    for(const [name,v]of Object.entries(expected))errors[name]=compare(observed.values[name],v);
    const record={caseName:'gradient',dims:f.dims,loss:lossValue,...observed,errors};
    results.push(record);await onCase(record);
  }finally{run.dispose();}
  const first=chunk(f,0,1),a=await readTree(jax,gatedDeltaSequence(arrays(jax,first)),backend);
  const second=chunk(f,1,f.dims.steps,a.values.state),b=await readTree(jax,gatedDeltaSequence(arrays(jax,second)),backend);
  const expected=reference(f);
  const record={caseName:'split-continuation',dims:f.dims,values:{output:[...a.values.output,...b.values.output],state:b.values.state},errors:{
    output:compare([...a.values.output,...b.values.output],expected.output),state:compare(b.values.state,expected.state)}};
  results.push(record);await onCase(record);
  return results;
}
