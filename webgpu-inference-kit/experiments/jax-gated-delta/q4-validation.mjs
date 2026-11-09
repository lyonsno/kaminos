import {q4Fixture,q4Reference} from './q4-reference.mjs';
import {compare} from './reference.mjs';

export function validateQ4Result(result,expected) {
  if(result?.nonce!==expected.nonce||result.fixtureSha256!==expected.fixtureSha256)throw new Error('stale run/fixture');
  if(result.backend?.effective!=='webgpu'||result.backend.vendor?.toLowerCase()!==expected.vendor.toLowerCase())throw new Error('wrong effective backend/vendor');
  if(result.cases?.length!==3)throw new Error('incomplete Q4 cases');
  const fs=[q4Fixture(),expected.fixture.fixture,q4Fixture()];
  for(let i=0;i<3;i++){
    const c=result.cases[i],f=fs[i],r=q4Reference(f);
    if(c.backend!=='webgpu'||Object.entries(f.dims).some(([k,v])=>c.dims?.[k]!==v))throw new Error('wrong case backend/dimensions');
    const check=(actual,wanted)=>{if(!Array.isArray(actual))throw new Error('missing numerical field');return compare(actual,wanted);};
    if(i<2){
      if(c.caseName!=='q4-lora')throw new Error('wrong case');
      check(c.output,r.output);check([c.loss],[r.loss]);
      for(const name of ['input','a','b'])check(c.grad?.[name],r.grad[name]);
      if(i===1)check(c.output,expected.fixture.nativeOutput);
    }else{
      if(c.caseName!=='q4-lora-update'||c.learningRate!==1||!(c.afterLoss<c.beforeLoss))throw new Error('invalid update');
      const p=structuredClone(f.params);
      check(c.params?.input,p.input);
      for(const name of ['a','b']){
        p[name]=p[name].map((v,j)=>v-r.grad[name][j]);check(c.params?.[name],p[name]);
        if(c.params[name].every((v,j)=>v===f.params[name][j]))throw new Error('frozen adapter');
      }
      const after=q4Reference(f,p);
      check([c.beforeLoss],[r.loss]);check([c.afterLoss],[after.loss]);
      if(!c.handoff?.borrowedSurvived||!c.handoff?.sameDevice||!c.handoff?.frozenUnchanged)throw new Error('incomplete Kit handoff');
      check(c.handoff.output,after.output);
    }
  }
  return result;
}
