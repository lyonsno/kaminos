// Admission for the U2Net WebGPU witness's reference evidence, shared by the
// witness page and its contracts: a measurement is reported only against
// present, complete, as-recorded references, and only with finite deltas.
const SHA256=/^[0-9a-f]{64}$/;
export function admitReferenceCases(stages){
  const cases=Object.entries(stages??{});
  if(!cases.length)throw Error('no reference cases in stages.json');
  return cases.map(([name,row])=>{
    const ok=Array.isArray(row?.source)&&row.source.length===2&&Array.isArray(row?.pre)&&row.pre.length===2&&
      [...row.source,...row.pre].every(v=>Number.isSafeInteger(v)&&v>0)&&SHA256.test(row?.sha?.cutout??'');
    if(!ok)throw Error(`reference case ${name} lacks source/pre sizes or a recorded 64-hex cutout hash`);
    return {name,source:row.source,pre:row.pre,cutoutSha256:row.sha.cutout};
  });
}

const hex=async bytes=>{
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
};
export async function admitReferenceBytes({name,what,status,bytes,length,sha256}){
  if(status!==200)throw Error(`reference ${name} ${what}: HTTP ${status}`);
  if(bytes.length!==length)throw Error(`reference ${name} ${what}: ${bytes.length} bytes, expected ${length}`);
  // A supplied hash must be a real one: an empty or malformed value cannot skip verification.
  if(sha256!==undefined&&!SHA256.test(sha256))throw Error(`reference ${name} ${what}: malformed recorded hash`);
  if(sha256!==undefined&&await hex(bytes)!==sha256)throw Error(`reference ${name} ${what}: bytes differ from the recorded hash`);
  return bytes;
}

export function compareCutouts(name,got,want){
  if(got.length!==want.length||got.length%4)throw Error(`cutout ${name}: length ${got.length} vs reference ${want.length}`);
  let alphaDifferent=0,alphaMaxDelta=0,rgbMaxDelta=0;
  for(let i=0;i<want.length;i+=4){
    const d=Math.abs(got[i+3]-want[i+3]);if(d)alphaDifferent++;alphaMaxDelta=Math.max(alphaMaxDelta,d);
    for(let c=0;c<3;c++)rgbMaxDelta=Math.max(rgbMaxDelta,Math.abs(got[i+c]-want[i+c]));
  }
  const result={alphaDifferent,alphaMaxDelta,rgbMaxDelta,pixels:want.length/4};
  if(!Object.values(result).every(Number.isFinite))throw Error(`cutout ${name}: non-finite comparison`);
  return result;
}
