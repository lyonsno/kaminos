import assert from 'node:assert/strict';

import { verifySam31PacketFloat32Bytes } from '../src/index.js';

const values = new Float32Array([1.25, -2.5, 3.75, 9]);
const bytes = values.buffer.slice(0);
const digest = await crypto.subtle.digest('SHA-256', bytes);
const sha256 = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
const entry = { role: 'fixture', file: 'fixture.f32.bin', sha256, byteLength: bytes.byteLength, shape: [4], dtype: 'float32' };
assert.deepEqual(Array.from(await verifySam31PacketFloat32Bytes(entry, bytes)), Array.from(values));

const tampered = bytes.slice(0);
new Uint8Array(tampered)[3] ^= 0xff;
await assert.rejects(() => verifySam31PacketFloat32Bytes(entry, tampered), /tensor byte hash mismatch for fixture/);
await assert.rejects(() => verifySam31PacketFloat32Bytes(entry, bytes.slice(0, -4)), /tensor byte length mismatch for fixture/);
await assert.rejects(() => verifySam31PacketFloat32Bytes({ ...entry, sha256: null }, bytes), /tensor manifest entry is incomplete/);

console.log('sam3.1 packet tensor byte-authentication contracts passed');
