// Invariants of the finished plate inspection, separate from browser transport.
export function assertSupportInspection(r){
  const fail=message=>{throw Error(message);};
  if(r.initial?.backend!=='WebGPU')fail('effective WebGPU route missing');
  if(r.initial?.candidate?.originalTriangles!==187308||r.initial?.candidate?.supportTriangles!==12||!(r.initial?.candidate?.sourcePatchTriangles>0))fail('source/support identity missing');
  if(!(r.initial?.candidate?.boundarySegments>0))fail('source/support boundary addresses missing');
  if(r.probe?.backend!=='WebGPU'||r.probe?.samples?.length!==9)fail('bounded geometric ray probes missing');
  for(const s of r.probe.samples){const m=s.material;if(!s.hit)fail('healthy plate probe must meet local source');if(m?.linearBaseColor?.length!==3||!m.linearBaseColor.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||![m.roughness,m.metalness].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||m.opacity!==1)fail('source material labels missing or invalid');}
  const lighting=r.lighting?.lighting,comparison=r.lightingConformance;
  if(r.lighting?.lightingPending!==false||lighting?.route!=='textured-clipped-source-shared-transport'||lighting.bounces!==1||lighting.environment!==0||lighting.radiance?.length!==9||lighting.radiance.some(v=>v.length!==4||!v.every(Number.isFinite))||!lighting.radiance.some(v=>v.slice(0,3).some(c=>c>0)))fail('textured source lighting missing, blank, partial or invalid');
  if(!Number.isFinite(comparison?.maxAbsoluteError)||comparison.maxAbsoluteError>=.002||comparison.rows?.length!==9)fail('source lighting conformance missing or failed');
  if(r.sourceBytes?.sha256!=='fb92b5218ec297d51020f6008c5b69779c544589aa56b2e22ecf399f7ad7c45d')fail('source bytes differ from finished plate fixture');
  if(r.changed?.region?.origin?.[0]!==.16||r.changed?.pending!==false||JSON.stringify(r.changed?.candidate?.sourceTriangleIds)===JSON.stringify(r.initial?.candidate?.sourceTriangleIds))fail('region control did not change source selection');
  if(r.near?.effective!=='source'||r.far?.effective!=='support')fail('LOD routing branches were not exercised');
  if(r.pageErrors?.length||r.consoleErrors?.length)fail('browser errors remain');
  if(!Array.isArray(r.captures)||r.captures.length<4||r.captures.some(p=>typeof p!=='string'||!p))fail('source, partition, support and whole-object captures required');
  return r;
}
