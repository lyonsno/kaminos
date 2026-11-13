// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCausewaySource,causewayDefaults} from '../causeway-source.mjs';

test('causeway retains fitted separate columns and repeatable shallow stone features',()=>{
 const source=createCausewaySource();
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
 const flat=createCausewaySource({relief:0});
 assert.deepEqual(flat.columns.map(c=>c.cell),source.columns.map(c=>c.cell));
 assert.ok(flat.triangles.every(t=>[t.a,t.b,t.c].every(p=>Math.abs(p[1]+causewayDefaults.sheetGap)<1e-12)));
 for(const field of ['relief','shoulder','dish','grain'])assert.throws(()=>createCausewaySource({[field]:-1}),/Invalid/);
});
