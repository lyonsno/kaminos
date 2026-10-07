import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readArchGlbTriangles } from '../structural-material-arch-profile.mjs';
import { prepareStoneFromGlb } from '../structural-material-stone-prepare.mjs';
import { buildGpuStoneFixture } from '../structural-material-stone-fixture.js';

const bytes = fs.readFileSync(new URL('../assets/arch-stones/03-bedded-stone-500-normal.glb', import.meta.url));
const source = readArchGlbTriangles(bytes);
assert.equal(source.triangles.length, 500, 'the actual imported stone uses the standard default triangle mode');
assert(source.bounds3d.max.every((value, axis) => value > source.bounds3d.min[axis]));
const [thin, thick] = [.3, .6].map(t => prepareStoneFromGlb(bytes, { size: [2.4,t,.6], cellSize:.3 }));
assert.equal(thin.cells.length, 16); assert.equal(thick.cells.length, 32);
assert.deepEqual(thin.spacing, thick.spacing);
assert(Math.abs(thick.volume/thin.volume-2)<1e-6);
for (const s of [thin, thick]) {
  assert(Math.abs(s.cells.reduce((n,c)=>n+c.volume,0)-s.volume)<s.volume*1e-5);
  assert(s.cells.every(c=>c.geometry.interfaces.every((id,i)=>c.geometry.exterior[i] ? id===null : s.bonds.some(b=>b.id===id&&(b.a===c.index||b.b===c.index)))));
  assert(s.cells.some(c=>c.geometry.exterior.some(Boolean)));
  assert(s.cells.some(c=>c.geometry.exterior.some(v=>!v)));
}
const section=s=>s.bonds.filter(b=>b.normal[0]===1&&s.cells[b.a].column===3).reduce((n,b)=>n+b.area,0);
assert(Math.abs(section(thick)/section(thin)-2)<1e-5);
assert.deepEqual(buildGpuStoneFixture(thin).config,buildGpuStoneFixture(thick).config,'material, solver, gravity and grip are shared');
const corrupt=structuredClone(thin);corrupt.cells[2].volume*=2;
assert.throws(()=>buildGpuStoneFixture(corrupt),/volume/i,'a stale total must not conceal changed physical mass');
const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
json.accessors[json.meshes[0].primitives[0].indices].count-=3;
const open=Buffer.from(bytes),edited=Buffer.from(JSON.stringify(json));
assert(edited.length<=jsonLength);open.fill(32,20,20+jsonLength);edited.copy(open,20);
assert.throws(()=>prepareStoneFromGlb(open,{size:[2.4,.3,.6],cellSize:.3}),/manifold/i,'an open imported surface cannot silently become a filled box');
console.log('stone preparation, volume, interface and material contracts passed');
