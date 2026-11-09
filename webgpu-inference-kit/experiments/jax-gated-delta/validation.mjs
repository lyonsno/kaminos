import {fixture,reference,finiteDifference,objective,compare} from './reference.mjs';

export function validateBrowserResult(result,{nonce,vendor}) {
  if(result?.nonce!==nonce)throw new Error('run nonce mismatch');
  if(result.backend?.effective!=='webgpu')throw new Error('wrong effective backend');
  if(result.backend?.vendor?.toLowerCase()!==vendor.toLowerCase())throw new Error('wrong GPU vendor');
  const expected=['forward','forward','gradient','split-continuation'];
  if(!Array.isArray(result.cases)||result.cases.length!==expected.length||result.cases.some((c,i)=>c.caseName!==expected[i]))
    throw new Error('missing or unexpected numerical cases');
  if(!result.interop?.sameDevice||!result.interop?.borrowedInputSurvived||!result.interop?.deviceSurvived)
    throw new Error('Kit interoperability incomplete');
  const fixtures=[fixture(),fixture({batch:2,steps:4,heads:2,keys:3,values:2}),fixture(),fixture()];
  for(let i=0;i<fixtures.length;i++){
    const c=result.cases[i],f=fixtures[i];
    if(!c.dims||Object.entries(f.dims).some(([name,value])=>c.dims[name]!==value))
      throw new Error('unexpected case dimensions');
    const expectedValues=c.caseName==='gradient'?finiteDifference(f):reference(f);
    for(const [name,values]of Object.entries(expectedValues)){
      if(!Array.isArray(c.values?.[name]))throw new Error('missing numerical field '+name);
      compare(c.values[name],values);
    }
    if(c.caseName==='gradient')compare([c.loss],[objective(f)]);
  }
  const output=reference(fixtures[0]).output;
  for(const [name,expectedValues]of Object.entries({transformed:output.map(x=>2*x+1),afterDispose:output,later:output.map(x=>3*x)})){
    if(!Array.isArray(result.interop[name]))throw new Error('missing Kit numerical field '+name);
    compare(result.interop[name],expectedValues);
  }
  return result;
}
