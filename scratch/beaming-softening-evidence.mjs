import assert from 'node:assert/strict';
export function assertSofteningView(view,{passes,gain,sourceHash,baselineSource,surfaceHash,baselineSurface,smokeHash,baselineSmoke,thin=false}){
  assert.equal(view.volume.error,null);
  assert.equal(view.lighting.identity,'distributed-volume-direct-radiance-v0');
  assert.equal(view.lighting.directions,24);assert.equal(view.lighting.frame.directions,24);
  assert.equal(view.lighting.gain,gain);assert.equal(view.lighting.frame.gain,gain);
  assert.equal(view.lighting.sourceSoftness,passes);assert.equal(view.lighting.frame.sourceSoftness,passes);
  assert.equal(view.lighting.smokeMode,'distributed');assert.equal(view.lighting.frame.volumeReceivers,8192);
  assert.ok(view.lighting.frame.surfaceReceivers>0);assert.ok(view.lighting.frame.generation>0);
  assert.equal(sourceHash,baselineSource,'raw source must be held');
  assert.ok(typeof surfaceHash==='string'&&surfaceHash.length===64);
  assert.ok(typeof smokeHash==='string'&&smokeHash.length===64,'smoke hash required');
  assert.equal(view.smoke?.length,8192*4,'complete smoke field required');
  assert.ok(view.smoke.every(Number.isFinite)&&view.smoke.some((v,i)=>i%4<3&&v>0),'nonblank finite smoke required');
  const reconstruction=view.lighting.frame.smokeReconstruction;
  assert.equal(reconstruction?.identity,'prepared-geometry-visible-v1');
  assert.deepEqual(reconstruction.dimensions,[64,128,64]);
  assert.equal(reconstruction.staticPreparations,1);assert.ok(reconstruction.updates>0);
  const incident=view.volume.physicalColor?.incidentLight;
  assert.equal(incident?.model,'distributed-volume-direct-radiance-v0');
  assert.equal(incident.legacyDispatched,false);assert.equal(incident.receivers,8192);
  assert.equal(incident.generation,view.lighting.frame.generation);
  if(passes)assert.notEqual(smokeHash,baselineSmoke,'smoke must respond to softness');
  else assert.equal(smokeHash,baselineSmoke,'zero must restore smoke');
  if(passes){
    const s=view.lighting.frame.sourceSoftening;
    assert.equal(s.identity,'solid-bounded-emission-diffusion-v1');assert.equal(s.passes,passes);
    assert.equal(s.staticPreparations,1);assert.ok(s.updates>0);
    assert.deepEqual(s.dimensions,[32,64,32]);assert.equal(s.extinction,'unchanged');
    assert.equal(s.rawSourceMutated,false);assert.notEqual(surfaceHash,baselineSurface,'filter must change actual receivers');
  }else assert.equal(surfaceHash,baselineSurface,'zero must restore actual receivers');
  if(thin){assert.equal(view.volume.controls.density,.35);assert.equal(view.volume.controls.physicalSmokeExtinction,.1);}
}
