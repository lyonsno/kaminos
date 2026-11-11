// Invariants of the first beam inspection, separate from browser transport.
export function assertSupportInspection(r){
  const fail=message=>{throw Error(message);};
  if(r.initial?.backend!=='WebGPU')fail('effective WebGPU route missing');
  if(r.initial?.candidate?.originalTriangles!==97670||r.initial?.candidate?.supportTriangles!==12||!(r.initial?.candidate?.sourcePatchTriangles>0))fail('source/support identity missing');
  if(r.sourceBytes?.sha256!=='7be0be2857ce5100ffa86f329e4068ba83ebb701c8582e2f982d28e68b8f8bdd')fail('source bytes differ from beam fixture');
  if(r.changed?.region?.origin?.[0]!==.16||r.changed?.pending!==false||JSON.stringify(r.changed?.candidate?.sourceTriangleIds)===JSON.stringify(r.initial?.candidate?.sourceTriangleIds))fail('region control did not change source selection');
  if(r.near?.effective!=='source'||r.far?.effective!=='support')fail('LOD routing branches were not exercised');
  if(r.pageErrors?.length||r.consoleErrors?.length)fail('browser errors remain');
  if(!Array.isArray(r.captures)||r.captures.length<4||r.captures.some(p=>typeof p!=='string'||!p))fail('source, partition, support and whole-object captures required');
  return r;
}
