// File representation is independent of the model's logical float32 tensors.
// Compact files must reconstruct the original bytes, including signed zero.
const safeFile = value => typeof value==='string' && /^[\w.-]+$/.test(value) && value!=='.' && value!=='..';
const sha = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export function generationTensorStorage(row) {
  if(row.storage===undefined)return {encoding:'f32-le',file:row.file,byteLength:row.byteLength,sha256:row.sha256};
  const s=row.storage;
  if(!s || !['bf16-le','f16-le'].includes(s.encoding) || !safeFile(s.file) ||
    !Number.isSafeInteger(s.byteLength) || s.byteLength!==row.byteLength/2 || !sha(s.sha256))
    throw TypeError('identified complete checkpoint storage required');
  return s;
}
const halfWords=new Uint32Array(65536),halfValues=new Float32Array(halfWords.buffer);
for(let h=0;h<65536;h++){
  const sign=h&32768?-1:1,exponent=(h>>>10)&31,fraction=h&1023;
  halfValues[h]=exponent===31 ? (fraction?NaN:sign*Infinity) :
    sign*(exponent===0?fraction*2**-24:(1+fraction/1024)*2**(exponent-15));
}
const littleEndian=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;
function words(raw){
  if(!littleEndian)throw Error('little-endian tensor host required');
  if(!(raw instanceof ArrayBuffer)||raw.byteLength%4)throw TypeError('complete float32 byte buffer required');
  return new Uint32Array(raw);
}
export function packGenerationTensor(raw) {
  const source=words(raw),packed=new Uint16Array(source.length);
  let bf16=true;
  for(let i=0;i<source.length;i++){if(source[i]&65535){bf16=false;break;}packed[i]=source[i]>>>16;}
  if(bf16)return {encoding:'bf16-le',bytes:packed.buffer};
  for(let i=0;i<source.length;i++){
    const w=source[i],e=(w>>>23)&255,f=w&0x7fffff,sign=(w>>>16)&32768;let h;
    if(e===0&&f===0)h=sign;
    else if(e>=113&&e<=142&&!(f&8191))h=sign|((e-112)<<10)|(f>>>13);
    else if(e>=103&&e<113){const shift=126-e,mantissa=0x800000|f;
      if(mantissa&((2**shift)-1))return null;h=sign|(mantissa>>>shift);}
    else if(e===255&&f===0)h=sign|31744;
    else return null;
    if(halfWords[h]!==w)return null;packed[i]=h;
  }
  return {encoding:'f16-le',bytes:packed.buffer};
}
export function expandGenerationTensor(raw,encoding) {
  if(encoding==='f32-le'){words(raw);return raw;}
  if(!littleEndian||!(raw instanceof ArrayBuffer)||raw.byteLength%2)throw TypeError('complete little-endian compact checkpoint bytes required');
  if(!['bf16-le','f16-le'].includes(encoding))throw TypeError('known checkpoint storage encoding required');
  const source=new Uint16Array(raw),result=new Uint32Array(source.length);
  for(let i=0;i<source.length;i++)result[i]=encoding==='bf16-le'?source[i]<<16:halfWords[source[i]];
  return result.buffer;
}
export async function readGenerationTensor(row,{fetchFile,hash,onPhase=()=>{}}) {
  const storage=generationTensorStorage(row);
  onPhase('fetch');const response=await fetchFile(storage.file);
  if(!response.ok)throw Error('checkpoint tensor unavailable '+storage.file);
  onPhase('response-body');let raw=await response.arrayBuffer();onPhase('storage-sha256');
  if(raw.byteLength!==storage.byteLength||await hash(raw)!==storage.sha256)
    throw Error('partial/changed checkpoint storage '+storage.file);
  if(storage.encoding!=='f32-le'){
    onPhase('decode');raw=expandGenerationTensor(raw,storage.encoding);onPhase('decoded-sha256');
    if(raw.byteLength!==row.byteLength||await hash(raw)!==row.sha256)
      throw Error('changed reconstructed checkpoint tensor '+row.file);
  }
  onPhase('verified');return new Float32Array(raw);
}
