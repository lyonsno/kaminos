import assert from 'node:assert/strict';
export function admitSceneGILinearAddition({zero,lit,received,width,height,region}) {
  assert.ok(width>0&&height>0&&zero.length===width*height*4&&lit.length===zero.length&&received.length===zero.length);
  const {x0=0,x1=width,y0=0,y1=height}=region||{};
  assert.ok([x0,x1,y0,y1].every(Number.isInteger)&&x0>=0&&y0>=0&&x1<=width&&y1<=height&&x0<x1&&y0<y1);
  const halfUlp=value=>Math.abs(value)<2**-14?2**-24:2**(Math.floor(Math.log2(Math.abs(value)))-10);
  let added=0,expected=0,error=0,maxError=0,roundingBudget=0,resolvedChannels=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)for(let c=0;c<3;c++) {
    const i=(y*width+x)*4+c;
    assert.ok([zero[i],lit[i],received[i]].every(Number.isFinite));
    const difference=lit[i]-zero[i],e=Math.abs(difference-received[i]);
    // Half-float sample writes and MSAA resolve each round before subtraction.
    const bound=2*(halfUlp(zero[i])+halfUlp(lit[i])+halfUlp(received[i]));
    assert.ok(e<=bound,'received field differs beyond attachment rounding');
    roundingBudget+=bound;if(received[i]>bound)resolvedChannels++;
    added+=difference;expected+=received[i];error+=e;maxError=Math.max(maxError,e);
  }
  assert.ok(expected>0,'received bounce must reach the measured region');
  return {added,expected,error,maxError,relativeError:error/expected,roundingBudget,resolvedChannels};
}
export function admitSceneGIComparison(e) {
  assert.ok(e?.native&&e.root===e.expectedRoot&&e.root,'scene GI evidence requires the native expected route');
  assert.deepEqual(e.errors,[],'scene GI evidence contains render errors');
  assert.ok(e.sourceBefore&&e.sourceBefore===e.sourceAfter,'scene GI evidence changed the held source');
  assert.ok(Number.isFinite(e.giRaw?.max)&&e.giRaw.max>0&&e.giRaw.nonzero>0,'scene GI evidence has no finite indirect radiance');
  for(const name of ['baseline','restored','combined','zero','bounce','visibility']) {
    const p=e[name];
    assert.ok(p?.width>0&&p?.height>0&&p.values?.length===p.width*p.height*4,'scene GI evidence has missing/partial pixels');
    assert.ok(p.values.every(Number.isFinite),'scene GI evidence has nonfinite pixels');
    assert.equal(p.width,e.baseline.width,'scene GI evidence dimensions differ');
    assert.equal(p.height,e.baseline.height,'scene GI evidence dimensions differ');
    let lo=255,hi=0;
    p.values.forEach((v,i)=>{if(i%4<3){lo=Math.min(lo,v);hi=Math.max(hi,v);}});
    assert.ok(hi-lo>1,'scene GI evidence is blank');
  }
  const delta=(a,b)=>{
    let sum=0;for(let i=0;i<a.values.length;i++)if(i%4<3)sum+=Math.abs(a.values[i]-b.values[i]);
    return sum/(a.width*a.height*3);
  };
  const bounceDelta=delta(e.combined,e.zero),restoreDelta=delta(e.baseline,e.restored);
  for (const [name,view] of [['bounce','gi'],['visibility','ao']]) {
    const p=e[name];
    assert.ok(p.view===view&&p.gain===1,'scene GI evidence has wrong diagnostic settings');
    assert.ok(p.frameAfter>p.frameBefore,'scene GI evidence has stale diagnostic execution');
    assert.ok(delta(p,e.combined)>0,'scene GI evidence diagnostic substituted composed output');
  }
  assert.ok(bounceDelta>0,'scene GI evidence shows disconnected bounce control');
  assert.ok(restoreDelta<=1,'scene GI evidence did not restore baseline');
  return {bounceMeanCodeDelta:bounceDelta,baselineMeanCodeDelta:restoreDelta};
}
