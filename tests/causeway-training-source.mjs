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
import {createCausewaySource} from '../causeway-source.mjs';
import {createCausewayDisplay} from '../causeway-display.mjs';
test('display and teacher retain the same canonical surface under large layout shifts',()=>{
 const source=createCausewaySource({layoutJitter:8}),teacher=createCausewayTrainingSource({layoutJitter:8});
 const area=(a,b,c)=>{const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};
 const p=createCausewayDisplay(source).byMaterial.flat();let displayed=0;for(let i=0;i<p.length;i+=9)displayed+=area(p.slice(i,i+3),p.slice(i+3,i+6),p.slice(i+6,i+9));
 const traced=teacher.triangles.reduce((s,t)=>s+area(t.a,t.b,t.c),0);assert.ok(Math.abs(displayed-traced)<1e-10,`${displayed} vs ${traced}`);
});
