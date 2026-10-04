import assert from 'node:assert/strict';
export function admitSceneGIComparison(e) {
  assert.ok(e?.native&&e.root===e.expectedRoot&&e.root,'scene GI evidence requires the native expected route');
  assert.deepEqual(e.errors,[],'scene GI evidence contains render errors');
  assert.ok(e.sourceBefore&&e.sourceBefore===e.sourceAfter,'scene GI evidence changed the held source');
  assert.ok(Number.isFinite(e.giRaw?.max)&&e.giRaw.max>0&&e.giRaw.nonzero>0,'scene GI evidence has no finite indirect radiance');
  for(const name of ['baseline','restored','combined','zero']) {
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
  assert.ok(bounceDelta>0,'scene GI evidence shows disconnected bounce control');
  assert.ok(restoreDelta<=1,'scene GI evidence did not restore baseline');
  return {bounceMeanCodeDelta:bounceDelta,baselineMeanCodeDelta:restoreDelta};
}
