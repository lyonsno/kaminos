// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createCausewayTrainingSource} from '../causeway-training-source.mjs';
test('Causeway teacher keeps one canonical square cell and traces its periodic continuation',()=>{
 const s=createCausewayTrainingSource({width:.12,depth:.12,relief:.02369140625,sheetGap:0});
 assert.equal(s.periodic.width,.12);assert.equal(s.periodic.depth,.12);
 assert.ok(s.triangles.length>1000&&s.triangles.length<20000);
 for(const t of s.triangles)for(const p of [t.a,t.b,t.c]){assert.ok(p.every(Number.isFinite));assert.ok(Math.abs(p[0])<=.060000001&&Math.abs(p[2])<=.060000001);assert.ok(p[1]<=s.periodic.maxY&&p[1]>=s.periodic.minY);}
 assert.equal(s.chart.boundary,'repeat');assert.ok(s.referenceHeight>=s.periodic.maxY);
});
