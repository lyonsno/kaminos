export function checkFuseMaterialEvidence(result){
  if(result?.backend!=='WebGPU'||result.samples!==96||!Array.isArray(result.rows)||result.rows.length!==2||!Array.isArray(result.errors)||result.errors.length)throw Error('Invalid native fuse route or incomplete evidence');
  for(const [index,name] of ['unlit-control','finite-end-heat'].entries()){
    const row=result.rows[index];if(row.name!==name||row.steps!==1800||row.dt!==1/60||row.spacing!==.01)throw Error('Fuse fixture identity mismatch');
    for(const key of ['expected','actual'])if(!Array.isArray(row[key])||row[key].length!==96*8||!row[key].every(Number.isFinite))throw Error('Missing or nonfinite fuse signal');
    if(row.actual.some((value,i)=>Math.abs(value-row.expected[i])>.005))throw Error('Native fuse law diverges from numerical reference');
  }
  const cold=result.rows[0].actual,hot=result.rows[1].actual;
  for(let i=0;i<96;i++)if(cold[i*8]!==0||cold[i*8+5]!==1)throw Error('Unlit fuse changed');
  if(hot[12*8+5]>.5||hot[5]>.01)throw Error('Fuse failed to propagate or exhaust its heated tail');
  return true;
}
