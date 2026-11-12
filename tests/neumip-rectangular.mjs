// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createNeumipStudent} from '../neumip-training.mjs';
import {writeNeumipModel,readNeumipModel} from '../neumip-model.mjs';
import {writeStoneHandoffModel,readStoneHandoffModel,handoffWeight} from '../stone-handoff-model.mjs';
const chart={width:.16,depth:.08,offsetMeters:.008,boundary:'clamp'};
const handoff={cheapResolution:32,cheapHeight:16,routing:{kind:'strip',width:.16,depth:.08,inner:.08,collar:.04},material:{color:[.48,.43,.35],roughness:.88,metalness:0}};
test('rectangular students retain physical chart through exported runtime archive',()=>{
 const m=createNeumipStudent({resolution:32,height:16,chart});assert.equal(m.offset.height,16);assert.deepEqual(m.mips.map(t=>[t.width,t.height]),[[32,16],[16,8],[8,4],[4,2],[2,1]]);
 const r=readNeumipModel(writeNeumipModel(m));assert.deepEqual(r.chart,chart);assert.deepEqual(r.offset,m.offset);
});
test('paired strip archive preserves matched rectangular cheap field and directional routing',()=>{
 const m=createNeumipStudent({resolution:32,height:16,chart,handoff});const r=readStoneHandoffModel(writeStoneHandoffModel(m));assert.equal(r.handoff.cheap[0].height,16);assert.deepEqual(r.chart,chart);
 assert.equal(handoffWeight([.2,.5],0,[32,16],handoff.routing),1);assert.equal(handoffWeight([.9,.5],0,[32,16],handoff.routing),0);
 assert.ok(Math.abs(handoffWeight([.625,.1],0,[32,16],handoff.routing)-.5)<1e-12);
});
test('invalid rectangle and physical coordinate metadata cannot silently become square',()=>{
 assert.throws(()=>createNeumipStudent({resolution:32,height:15,chart}),/height|power/i);
 assert.throws(()=>createNeumipStudent({resolution:32,height:16,chart:{...chart,depth:0}}),/chart/i);
});
import {createShoulderStripSource,shoulderStripHeight} from '../shoulder-strip-source.mjs';
test('marked shoulder retains relief through the fade and flat endpoint with surrounding geometry',()=>{
 const s=createShoulderStripSource({cellsX:64,cellsY:32});assert.ok(shoulderStripHeight(.10,0,s.config)<0);assert.equal(shoulderStripHeight(.13,0,s.config),0);
 assert.ok(s.triangles.some(t=>t.a[0]<-.08)&&s.triangles.some(t=>t.a[0]>.08));assert.equal(s.chart.boundary,'clamp');assert.ok(new Set(s.triangles.map(t=>t.materialIndex)).size>1);
 for(const t of s.triangles){const u=t.b.map((v,i)=>v-t.a[i]),v=t.c.map((v,i)=>v-t.a[i]);assert.ok(u[2]*v[0]-u[0]*v[2]>0);}
});
test('a single cheap LOD cannot silently change footprint aspect ratio',()=>{
 assert.throws(()=>createNeumipStudent({resolution:32,height:16,chart,handoff:{...handoff,cheapResolution:16,cheapHeight:16}}),/aspect/);
});
