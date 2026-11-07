// kaminos-test: node
import assert from 'node:assert/strict';
import {assertMicrostructureServer} from '../tools/microstructure-witness-identity.mjs';
const expected={repoRoot:'/owned/source',branch:'cc/experiment',commit:'exact-revision'},actual={...expected,dirty:false};
assert.equal(assertMicrostructureServer(expected,actual),actual);
for(const bad of [null,{...actual,commit:'other-revision'},{...actual,repoRoot:'/other/source'},{...actual,branch:'other'},{...actual,dirty:true},{...expected}])assert.throws(()=>assertMicrostructureServer(expected,bad),/renderer source/);
console.log('Renderer attribution rejects unavailable, wrong-revision, wrong-root and dirty effective source independently of matching asset identity');
