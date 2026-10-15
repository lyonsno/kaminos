import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function admitCapturedShape(meta, readFile, manifestBytes) {
  const plan=meta?.decoder?.plan,rows=plan?.tokenRows;
  if(meta?.decoder?.mode!=='shape'||plan?.mode!=='shape'||!Number.isSafeInteger(rows)||rows<1||plan.latentChannels!==32)
    throw Error('captured shape decoder plan required');
  if(hash(manifestBytes)!==meta.input?.checkpointManifestSha256)throw Error('checkpoint manifest identity mismatch');
  const specs=[['tensor.inputs.sample',[rows,32],'f32'],['tensor.inputs.coordinates',[rows,3],'i32']];
  const inputs={};
  for(const [name,shape,dtype]of specs){
    const matches=meta.files?.filter(f=>f.name===name)??[],spec=matches[0];
    if(matches.length!==1||spec.dtype!==dtype||JSON.stringify(spec.shape)!==JSON.stringify(shape)||spec.byteLength!==rows*shape[1]*4)
      throw Error('complete captured shape input required: '+name);
    const bytes=await readFile(name);
    if(bytes.length!==spec.byteLength||hash(bytes)!==spec.sha256)throw Error('captured tensor identity mismatch: '+name);
    // Buffer slices can be unaligned; copy the exact admitted range for typed access.
    const copy=Uint8Array.from(bytes).buffer;
    if(dtype==='f32'&&!new Float32Array(copy).every(Number.isFinite))throw Error('finite captured shape input required');
    inputs[name]=spec;
  }
  return {rows,plan,inputs,inputSha256:inputs['tensor.inputs.sample'].sha256,
    coordinateSha256:inputs['tensor.inputs.coordinates'].sha256,manifestSha256:hash(manifestBytes)};
}
