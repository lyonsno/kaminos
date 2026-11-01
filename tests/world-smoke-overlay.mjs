// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as optics from '../volume-world-smoke-optics.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('overlay reports effective world-space geometry and independent cell pitches',()=>{
  assert.equal(typeof optics.worldSmokeOverlayGeometry,'function','effective geometry must be exposed, not inferred from requested settings');
  const g=optics.worldSmokeOverlayGeometry({effective:'one-way-world-field',min:[-3,-3,-3],max:[3,9,3],anchor:{translate:[10,20,30],scale:2},flowDims:[16,32,16],materialDims:[32,64,32],fineDims:[32,64,32],fineTransform:{translate:[10,20,30],scale:2}});
  assert.deepEqual(g.worldMin,[4,14,24]);assert.deepEqual(g.worldMax,[16,38,36]);
  assert.deepEqual(g.fineMin,[8,18,28]);assert.deepEqual(g.fineMax,[12,26,32]);
  assert.equal(g.finePitch,.125);assert.equal(g.materialPitch,.375);assert.equal(g.flowPitch,.75);assert.equal(g.volumeRatio,27);
  assert.equal(optics.worldSmokeOverlayGeometry({effective:'off'}),null);
  assert.equal(optics.worldSmokeOverlayGeometry({effective:'one-way-world-field'}),null);
});
test('witness preserves source-discovery failure before browser launch',()=>{
 const out=mkdtempSync(join(tmpdir(),'world-overlay-source-failure-'));
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../world-smoke-overlay-witness.mjs',import.meta.url)),'http://unused',out,'unused','unused','unused'],{env:{...process.env,PATH:'/nonexistent-overlay-test-path'},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.ok(existsSync(join(out,'report.json')),'pre-browser failure needs a durable report');
 const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));assert.equal(report.status,'failed');assert.equal(report.phase,'source-identity');assert.match(report.error,/git.*ENOENT/);assert.equal(report.source,null);
});
test('intermediate bounds and pitches come from its dispatched allocation',()=>{
 const s={effective:'one-way-world-field',min:[-3,-3,-3],max:[3,9,3],anchor:{translate:[10,20,30],scale:2},flowDims:[16,32,16],materialDims:[32,64,32],fineDims:[32,64,32],fineTransform:{translate:[10,20,30],scale:2},intermediate:{effective:'independent-material-and-flow',min:[-1.5,-1.5,-1.5],max:[1.5,3.5,1.5],flowPitch:.125,materialPitch:.0625,pressurePitch:.25}};
 const g=optics.worldSmokeOverlayGeometry(s);
 assert.deepEqual(g.middleMin,[7,17,27]);assert.deepEqual(g.middleMax,[13,27,33]);
 assert.equal(g.middleFlowPitch,.25);assert.equal(g.middleMaterialPitch,.125);assert.equal(g.middlePressurePitch,.5);
 s.intermediate.effective='off';assert.equal(optics.worldSmokeOverlayGeometry(s).middleMin,null);
});
