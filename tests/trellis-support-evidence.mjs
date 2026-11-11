// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import {assertSupportInspection} from '../trellis-support-evidence.mjs';
const fixture=()=>({initial:{backend:'WebGPU',candidate:{originalTriangles:97670,supportTriangles:12,sourcePatchTriangles:2,sourceTriangleIds:[1],boundarySegments:2}},sourceBytes:{sha256:'7be0be2857ce5100ffa86f329e4068ba83ebb701c8582e2f982d28e68b8f8bdd'},changed:{region:{origin:[.16,0,0]},pending:false,candidate:{sourceTriangleIds:[2]}},near:{effective:'source'},far:{effective:'support'},pageErrors:[],consoleErrors:[],captures:['a','b','c','d'],probe:{backend:'WebGPU',samples:Array.from({length:9},()=>({hit:true}))}});
test('missing visual evidence cannot pass a numerical-only inspection',()=>{const f=fixture();f.captures=[];assert.throws(()=>assertSupportInspection(f),/captures/);});
test('fallback, stale source, ignored controls, missing LOD branch and browser errors fail',()=>{
  for(const mutate of [f=>f.initial.backend='WebGL',f=>f.sourceBytes.sha256='stale',f=>f.changed.candidate.sourceTriangleIds=[1],f=>f.far.effective='source',f=>f.consoleErrors.push('GPU validation failed')]){const f=fixture();mutate(f);assert.throws(()=>assertSupportInspection(f));}
});
