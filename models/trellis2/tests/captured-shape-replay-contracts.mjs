// kaminos-test: node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {admitCapturedShape} from '../captured-shape-replay-checks.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=Buffer.from('{}');
const sample=Buffer.from(new Float32Array(32).buffer),coordinates=Buffer.from(new Int32Array([0,0,0]).buffer);
const files=[{name:'tensor.inputs.sample',shape:[1,32],dtype:'f32',byteLength:sample.length,sha256:hash(sample)},
  {name:'tensor.inputs.coordinates',shape:[1,3],dtype:'i32',byteLength:coordinates.length,sha256:hash(coordinates)}];
const meta={decoder:{mode:'shape',plan:{mode:'shape',tokenRows:1,latentChannels:32,resolution:32,activationStorage:'f16'}},
  input:{checkpointManifestSha256:hash(manifest)},files};
const read=async name=>name==='tensor.inputs.sample'?sample:coordinates;
await assert.rejects(admitCapturedShape({...meta,files:files.slice(1)},read,manifest),/complete captured shape input/);
await assert.rejects(admitCapturedShape(meta,async name=>name==='tensor.inputs.sample'?Buffer.from(sample).fill(1):coordinates,manifest),/captured tensor identity/);
await assert.rejects(admitCapturedShape(meta,read,Buffer.from('changed')),/checkpoint manifest identity/);
await assert.rejects(admitCapturedShape({...meta,decoder:{...meta.decoder,mode:'texture'}},read,manifest),/captured shape decoder/);
await assert.rejects(admitCapturedShape({...meta,files:files.map(f=>f.name.endsWith('sample')?{...f,shape:[1,31]}:f)},read,manifest),/captured shape input/);
const nan=Buffer.from(new Float32Array(Array(32).fill(NaN)).buffer);
await assert.rejects(admitCapturedShape({...meta,files:files.map(f=>f.name.endsWith('sample')?{...f,sha256:hash(nan)}:f)},
  async name=>name.endsWith('sample')?nan:coordinates,manifest),/finite captured shape/);
const admitted=await admitCapturedShape(meta,read,manifest);
assert.equal(admitted.rows,1);assert.equal(admitted.inputSha256,hash(sample));
console.log('captured shape replay: identity, shape, finite-input and manifest contracts passed');
