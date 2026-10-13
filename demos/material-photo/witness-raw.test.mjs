import test from 'node:test';
import assert from 'node:assert/strict';
import {readRawEvidence} from './witness-raw.mjs';

test('raw float evidence crosses CDP in complete transport-sized replies', async () => {
  const storage = new Uint8Array(3 * 512 * 512 * 4 + 16);
  for (let i = 0; i < storage.length; i++) storage[i] = i % 251;
  const data = new Float32Array(storage.buffer, 16);
  const window = {__materialPhotoActions:{materialEvidence:()=>({output:{width:512,height:512,planes:{orm:data}}})}};
  const evaluate = async expression => {
    const result = Function('window', `return ${expression}`)(window);
    // The isolated Chrome/153 replay admits 1 MiB and disconnects at 3 MiB.
    if (result.base64 && Buffer.from(result.base64, 'base64').length > 1024 * 1024) throw Error('CDP connection closed');
    return result;
  };
  const result = await readRawEvidence(evaluate, 'plane-orm');
  assert.equal(result.type, 'Float32Array');
  assert.equal(result.width, 512);
  assert.equal(result.height, 512);
  assert.deepEqual(result.bytes, Buffer.from(storage.buffer, 16));
});

test('truncated, stale-offset and changed-length chunks cannot certify raw evidence', async () => {
  for (const broken of [part => ({...part,base64:''}), part => ({...part,offset:1}), part => ({...part,byteLength:0})]) {
    const window = {__materialPhotoActions:{materialEvidence:()=>({image:{width:2,height:2,data:new Uint8ClampedArray(16)}})}};
    const evaluate = async expression => {
      const result = Function('window', `return ${expression}`)(window);
      return result.base64 ? broken(result) : result;
    };
    await assert.rejects(readRawEvidence(evaluate, 'image'), /Incomplete raw evidence transfer/);
  }
});

test('missing channels and malformed layouts fail before an artifact is admitted', async () => {
  await assert.rejects(readRawEvidence(async () => ({width:512,height:512,type:'Float32Array',byteLength:4}), 'plane-orm'), /Invalid raw evidence layout/);
  await assert.rejects(readRawEvidence(async () => null, 'image'), /Invalid raw evidence layout/);
  await assert.rejects(readRawEvidence(async () => assert.fail('Unknown channel reached browser'), 'fallback'), /Unknown raw evidence channel/);
});
