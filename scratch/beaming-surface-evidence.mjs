import assert from 'node:assert/strict';
export function floatEvidenceBytes(values) {
  assert.ok(values.length>0&&values.every(v=>typeof v==='number'&&Number.isFinite(v)),'float evidence must be nonempty finite numbers');
  return Buffer.from(new Float32Array(values).buffer);
}
export function assertSurfaceView(signal,{baseline,count,pattern,passes}) {
  assert.equal(signal.volume.error,null);assert.equal(signal.lighting.previewStale,false);
  const frame=signal.lighting.frame;
  assert.equal(frame.directions,count);assert.equal(frame.angularPattern,pattern);
  assert.equal(frame.surfaceReconstruction.passes,passes);assert.equal(frame.generation,signal.source.generation);
  for(const values of [signal.surface,signal.back,signal.smoke,signal.source.values])floatEvidenceBytes(values);
  assert.ok(frame.surfaceReceivers>0);
  if(!baseline){assert.equal(passes,0,'matching raw baseline required');return;}
  assert.equal(baseline.lighting.frame.directions,count,'baseline angular count mismatch');
  assert.equal(baseline.lighting.frame.angularPattern,pattern,'baseline angular pattern mismatch');
  assert.equal(baseline.lighting.frame.surfaceReconstruction.passes,0,'baseline must be raw');
  assert.equal(signal.lighting.geometryBuilds,baseline.lighting.geometryBuilds);
  assert.deepEqual(signal.source.values,baseline.source.values,'held source changed');
  assert.deepEqual(signal.smoke,baseline.smoke,'surface reconstruction changed smoke');
  if(passes) {
    assert.equal(frame.surfaceReconstruction.history,false);assert.ok(frame.surfaceReconstruction.directedEdges>0);
    assert.notDeepEqual(signal.surface,baseline.surface,'front reconstruction unchanged');
    assert.notDeepEqual(signal.back,baseline.back,'back reconstruction unchanged');
  }else {
    assert.deepEqual(signal.surface,baseline.surface,'raw front restoration mismatch');
    assert.deepEqual(signal.back,baseline.back,'raw back restoration mismatch');
  }
}
