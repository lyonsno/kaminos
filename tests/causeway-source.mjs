// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCausewaySource,causewayDefaults} from '../causeway-source.mjs';

test('causeway retains fitted separate columns and repeatable shallow stone features',()=>{
 const source=createCausewaySource({layoutJitter:.65});
 assert.equal(source.schema,'kaminos.causeway-source.v1');
 assert.equal(source.columns.length,16);
 assert.equal(source.chart.boundary,'repeat');
 assert.ok(source.triangles.length>1000);
 assert.ok(source.triangles.every(t=>[...t.a,...t.b,...t.c].every(Number.isFinite)));
 assert.ok(source.triangles.every(t=>Math.max(t.a[1],t.b[1],t.c[1])<source.referenceHeight));
 assert.ok(source.columns.every(c=>c.topArea<c.cellArea*.96&&c.topArea>c.cellArea*.6));
 assert.ok(new Set(source.columns.map(c=>c.sides)).size>1,'partition must contain more than uniform hexagons');
 assert.ok(new Set(source.columns.map(c=>c.topHeight.toFixed(6))).size>8);
 for(const kind of ['top','shoulder','side','backing'])assert.ok(source.triangles.some(t=>t.region===kind),kind);
 const a=source.triangles.filter(t=>t.tile[0]===0&&t.tile[1]===0),b=source.triangles.filter(t=>t.tile[0]===1&&t.tile[1]===0);
 assert.equal(a.length,b.length);
 a.forEach((t,i)=>{for(const k of ['a','b','c']){assert.ok(Math.abs(b[i][k][0]-t[k][0]-source.config.width)<1e-12);assert.equal(b[i][k][1],t[k][1]);assert.equal(b[i][k][2],t[k][2]);}assert.equal(t.materialIndex,b[i].materialIndex);});
 const flat=createCausewaySource({relief:0,layoutJitter:.65});
 assert.deepEqual(flat.columns.map(c=>c.cell),source.columns.map(c=>c.cell));
 assert.ok(flat.triangles.every(t=>[t.a,t.b,t.c].every(p=>Math.abs(p[1]+causewayDefaults.sheetGap)<1e-12)));
 for(const field of ['relief','shoulder','dish','grain'])assert.throws(()=>createCausewaySource({[field]:-1}),/Invalid/);
});
test('accepted high grain and zero gap stay behind the capture sheet',()=>{
 const source=createCausewaySource({sheetGap:0,dish:0,grain:.2,relief:.005});
 const maxY=source.triangles.reduce((m,t)=>Math.max(m,t.a[1],t.b[1],t.c[1]),-Infinity);
 assert.ok(maxY<=0,'all detailed geometry must remain below the carrier');
});
test('square source carries neighboring top frames and rounded shoulder geometry',()=>{
 const source=createCausewaySource({depth:.12,slant:.06,layoutJitter:.16});
 assert.equal(source.config.width,source.config.depth);
 assert.ok(source.columns.every(c=>Array.isArray(c.topSlope)&&c.topSlope.length===2));
 assert.ok(source.columns.some(c=>Math.hypot(...c.topSlope)>0));
 assert.ok(source.triangles.some(t=>t.region==='shoulder'));
 assert.ok(source.columns.every(c=>Number.isFinite(c.edgeThickness)&&c.edgeThickness>0));
});

import {createCausewayDisplay} from '../causeway-display.mjs';
test('faced cutaway adds finite boundary-plane sections without modifying the teacher',()=>{
 const s=createCausewaySource({relief:.02369140625,sheetGap:0,shoulder:.046,dish:.1666,grain:.02});
 const before=JSON.stringify(s.triangles),tiled=createCausewayDisplay(s),cut=createCausewayDisplay(s,{cutaway:true});
 assert.equal(tiled.sections.length,0);assert.ok(cut.sections.length>0);assert.equal(cut.sections.length%9,0);
 assert.ok(cut.sections.every(Number.isFinite));assert.deepEqual(cut.byMaterial,tiled.byMaterial);
 for(let i=0;i<cut.sections.length;i+=9){const p=cut.sections.slice(i,i+9);assert.ok([0,2].some(axis=>[s.config.width/2,-s.config.width/2].some(edge=>[0,3,6].every(j=>Math.abs(p[j+axis]-edge)<1e-8))));}
 assert.equal(JSON.stringify(s.triangles),before);
});
