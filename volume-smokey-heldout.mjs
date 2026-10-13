import assert from 'node:assert/strict';

export const SMOKEY_SCANLINES=[.1,.2,.3,.4,.5,.6,.7,.8,.9];
export function observeHttpFailures(page,report) {
  report.httpFailures=[];
  page.on('response',response=>{
    if(response.status()>=400)report.httpFailures.push({url:response.url(),status:response.status(),
      statusText:response.statusText(),headers:response.headers()});
  });
}

export function smokeyVariants(preset) {
  const controls=['radius','fuel','temperature'];
  const specs=[['baseline',[1,1,1]]];
  for(const [i,key] of controls.entries())for(const [label,factor] of [['half',.5],['double',2]]) {
    const factors=[1,1,1];factors[i]=factor;specs.push([`${key}-${label}`,factors]);
  }
  specs.push(['all-half',[.5,.5,.5]],['all-double',[2,2,2]]);
  return specs.map(([name,factors])=>{
    const result=structuredClone(preset);
    controls.forEach((key,i)=>{
      const control=result.domControls[`volume-immersed-${key}`];
      assert.ok(Number.isFinite(control?.value),`missing numeric ${key}`);
      control.value*=factors[i];
    });
    return {name,factors,preset:result};
  });
}

export function validateSmokeyControls(requested,effective) {
  for(const [key,control] of Object.entries(requested)) {
    assert.ok(Object.hasOwn(effective,key),`missing effective control ${key}`);
    const expected=control.value,actual=effective[key];
    if(typeof expected==='number')assert.ok(Number.isFinite(Number(actual))&&Math.abs(Number(actual)-expected)<=1e-10*Math.max(1,Math.abs(expected)),`effective ${key}: ${actual} != ${expected}`);
    else assert.equal(actual,expected,`effective ${key}`);
  }
}
