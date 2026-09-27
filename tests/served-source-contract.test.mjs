import assert from 'node:assert/strict';
import { assertServedSourceIdentity } from './served-source-contract.mjs';

const local = { 'index.html': 'aaa', 'sf3d-learn.mjs': 'bbb' };
assert.deepEqual(assertServedSourceIdentity(local, { 'index.html': 'aaa', 'sf3d-learn.mjs': 'bbb' }), local);
assert.throws(() => assertServedSourceIdentity(local, { 'index.html': 'wrong', 'sf3d-learn.mjs': 'bbb' }), /index\.html/);
assert.throws(() => assertServedSourceIdentity(local, { 'index.html': 'aaa' }), /sf3d-learn\.mjs/);
assert.throws(() => assertServedSourceIdentity(local, { 'index.html': 'aaa', 'sf3d-learn.mjs': 'bbb', 'extra.js': 'ccc' }), /extra\.js/);
console.log('served source mismatch and omissions fail closed');
