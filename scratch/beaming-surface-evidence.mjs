import assert from 'node:assert/strict';
export function floatEvidenceBytes(values) {
  assert.ok(values.length>0&&values.every(v=>typeof v==='number'&&Number.isFinite(v)),'float evidence must be nonempty finite numbers');
  return Buffer.from(new Float32Array(values).buffer);
}
export function assertRequiredModuleResponse({url,status},origin){
 const parsed=new URL(url);
 if(parsed.origin===origin&&/\.m?js$/.test(parsed.pathname)&&status>=400)throw Error(`required-module-load-failed:${status}:${url}`);
}
export function assertScatteringView(signal,{count,albedo,enabled,trim,master,spacing}){
 assert.equal(signal.volume.error,null);assert.equal(signal.lighting.previewStale,false);
 const f=signal.lighting.frame;
 if(spacing!==undefined){
  const r=f.receiverSampling;assert.ok(r,'receiver sampling metadata required');
  assert.equal(r.spacing,spacing,'receiver sampling effective spacing must match request');
  assert.equal(signal.lighting.receiverSpacingRequested,spacing,'receiver sampling live request must match');
  assert.equal(r.receivers,f.surfaceReceivers);assert.ok(Number.isSafeInteger(r.renderVertices)&&r.renderVertices>=r.receivers);
  assert.equal(r.identity,spacing?'connected-cell-normal-band-v1':'vertex-reference-v1');
  if(!spacing)assert.equal(r.receivers,r.renderVertices);
 }
 assert.equal(f.directions,count);assert.equal(f.angularPattern,'source');assert.equal(f.sourceSoftness,0);assert.equal(f.surfaceReconstruction.passes,0);
 assert.equal(f.gain,2**master);assert.equal(signal.lighting.surfaceGain,2**trim);
 assert.equal(signal.volume.physicalColor.material.scatteringAlbedo,Math.fround(albedo));
 assert.equal(signal.lighting.surfaceScattering,enabled);assert.equal(f.surfaceScattering.enabled,enabled);
 for(const snapshot of [f,signal.source,signal.scattering])for(const key of ['frame','generation']){
  assert.ok(Number.isSafeInteger(snapshot[key])&&snapshot[key]>=0);assert.equal(snapshot[key],f[key]);
 }
 if(enabled)assert.equal(f.surfaceScattering.sourceGeneration,f.generation);
 assert.deepEqual(signal.scattering.dimensions,signal.source.dimensions);
 const shape=(v,d,channels)=>{floatEvidenceBytes(v);assert.equal(d.length,3);assert.ok(d.every(n=>Number.isSafeInteger(n)&&n>0));assert.equal(v.length,channels*d.reduce((a,b)=>a*b,1));};
 shape(signal.source.values,signal.source.dimensions,4);shape(signal.scattering.values,signal.scattering.dimensions,1);
 for(const key of ['surface','back','smoke'])shape(signal[key],signal.dimensions[key],4);
 assert.ok(f.surfaceReceivers>0);assert.deepEqual(signal.dimensions.surface,signal.dimensions.back);
 const capacity=signal.surface.length/4;assert.ok(capacity>=f.surfaceReceivers&&capacity-f.surfaceReceivers<signal.dimensions.surface[0]);
}
export function assertSourceMotionView(signal,{count,pattern,heldSource,lightOnly=false}) {
  if(lightOnly){assert.equal(signal.environment.intensity,0);assert.equal(signal.environment.exposure,1);assert.equal(signal.environment.rim,false);}
  assert.equal(signal.volume.error,null);assert.equal(signal.lighting.previewStale,false);
  const frame=signal.lighting.frame;
  for(const snapshot of [frame,signal.source])for(const key of ['frame','generation'])assert.ok(Number.isSafeInteger(snapshot[key])&&snapshot[key]>=0,`valid ${key} snapshot identity required`);
  assert.equal(frame.directions,count);assert.equal(frame.angularPattern,pattern);
  assert.equal(frame.integration,pattern==='source'?'exact-cell':'midpoint');
  assert.equal(frame.sourceSoftness,0);assert.equal(frame.surfaceReconstruction.passes,0);
  assert.equal(frame.generation,signal.source.generation);assert.ok(frame.surfaceReceivers>0);
  assert.equal(frame.frame,signal.source.frame,'lighting/source snapshot frame mismatch');
  for(const values of [signal.surface,signal.back,signal.source.values])floatEvidenceBytes(values);
  const shape=(values,dims)=>{
    assert.equal(dims.length,3);assert.ok(dims.every(n=>Number.isSafeInteger(n)&&n>0));
    assert.equal(values.length,4*dims.reduce((a,b)=>a*b,1),'complete RGBA readback required');
  };
  shape(signal.surface,signal.dimensions.surface);shape(signal.back,signal.dimensions.back);shape(signal.source.values,signal.source.dimensions);
  assert.deepEqual(signal.dimensions.surface,signal.dimensions.back);assert.equal(signal.dimensions.surface[2],1);
  const capacity=signal.surface.length/4;
  assert.ok(capacity>=frame.surfaceReceivers&&capacity-frame.surfaceReceivers<signal.dimensions.surface[0],'receiver texture shape does not match receiver count');
  assert.deepEqual(signal.source.values,heldSource,'mode comparison must use identical live coefficients');
}
// This admission belongs to the observed lit kiln, not arbitrary fully occluded
// geometry: capture completion alone must not imply a functioning motion signal.
export function assertLitSourceMotionResponse(sequence) {
  assert.ok(sequence.length>1);
  const differs=(a,b,rgbOnly=false)=>a.length!==b.length||a.some((x,i)=>(!rgbOnly||i%4<3)&&x!==b[i]);
  assert.ok(sequence.some(s=>[s.surface,s.back].some(v=>v.some((x,i)=>i%4<3&&x>0))),'lit-kiln fixture has no received light');
  assert.ok(sequence.slice(1).some((s,i)=>differs(s.source.values,sequence[i].source.values)),'source sequence did not change');
  assert.ok(sequence.slice(1).some((s,i)=>differs(s.surface,sequence[i].surface,true)||differs(s.back,sequence[i].back,true)),'lit-kiln receiver response is frozen/disconnected');
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
export function assertSourceGuideEvidence(signal,requested){
  const {runtime,source,adapter,lighting,sourceGeneration,sourceMetadata,dimensions,primary,front,back,smoke,errors,httpFailures}=signal;
  if(!runtime?.source||runtime.source.repoRoot!==source?.root||runtime.source.commit!==source?.revision||runtime.source.dirty||source.dirty)throw Error('wrong/unverified clean source-guide route');
  if(adapter?.vendor!=='apple'||adapter.isFallbackAdapter!==false)throw Error('source-guide evidence requires the verified native Apple route');
  const frame=lighting?.frame;
  if(!Number.isSafeInteger(sourceGeneration)||sourceGeneration<0||frame?.generation!==sourceGeneration||frame.angularPattern!==requested.pattern||frame.directions!==requested.count||frame.receiverSampling?.spacing!==requested.spacing||lighting.gain!==requested.gain||lighting.surfaceGain!==1||!frame.surfaceScattering?.enabled||lighting.previewStale)throw Error('source-guide requested/effective config or generation mismatch');
  if(requested.pattern==='guided'&&(!frame.sourceGuide||!['lo','hi'].every(k=>Array.isArray(frame.sourceGuide[k])&&frame.sourceGuide[k].length===3&&frame.sourceGuide[k].every(Number.isFinite))))throw Error('effective source guide missing');
  const cells=d=>{
    if(!Array.isArray(d)||d.length!==3||!d.every(n=>Number.isSafeInteger(n)&&n>0))throw Error('complete field dimensions required');
    const n=d.reduce((a,b)=>a*b,1);if(!Number.isSafeInteger(n*4))throw Error('field dimensions exceed integer addressability');return n;
  };
  if(sourceMetadata?.generation!==sourceGeneration||sourceMetadata?.channels!==4)throw Error('primary field identity missing or mismatched');
  const sizes={primary:cells(sourceMetadata.dimensions),front:cells(dimensions?.front),back:cells(dimensions?.back),smoke:cells(dimensions?.smoke)};
  if(JSON.stringify(dimensions.front)!==JSON.stringify(dimensions.back)||dimensions.front[2]!==1||!Number.isSafeInteger(frame.surfaceReceivers)||frame.surfaceReceivers<1||Math.ceil(frame.surfaceReceivers/dimensions.front[0])!==dimensions.front[1])throw Error('surface field dimensions/count disagree with padded receiver layout');
  if(frame.allocatedVolumeReceivers!==sizes.smoke||frame.transportVolumeReceivers!==sizes.smoke)throw Error('smoke field dimensions/count disagree with represented receiver layout');
  for(const [name,values]of [['primary',primary],['front',front],['back',back],['smoke',smoke]])if(!Array.isArray(values)||values.length!==sizes[name]*4||!values.every(Number.isFinite))throw Error('missing/partial/nonfinite '+name);
  for(let i=0;i<frame.surfaceReceivers;i++)if(front[i*4+3]!==1||back[i*4+3]!==1)throw Error('unwritten active surface receiver');
  for(let i=0;i<sizes.smoke;i++)if(smoke[i*4+3]!==1)throw Error('unwritten smoke receiver');
  const hasRGB=(values,count=values.length/4)=>{for(let i=0;i<count;i++)for(let c=0;c<3;c++)if(values[i*4+c]>0)return true;return false;};
  if(!hasRGB(primary)||!hasRGB(front,frame.surfaceReceivers)&&!hasRGB(back,frame.surfaceReceivers))throw Error('blank active source-guide evidence');
  if(!Array.isArray(errors)||errors.length||!Array.isArray(httpFailures)||httpFailures.length)throw Error('source-guide capture contains renderer/HTTP errors');
  return signal;
}
