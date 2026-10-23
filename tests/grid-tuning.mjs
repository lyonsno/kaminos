// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {gridTuningPlan,gridWidthChoices,intermediateCoverageChoices,gridTuningSummary} from '../volume-grid-tuning.mjs';
const c={pressureSolver:"converged-open-top",resolution:64,gridHeightRatio:2,fineVelocity:32,finePressure:16,pressureSolverIterations:12,worldSmoke:'on',worldSmokeFlow:16,worldSmokeMaterial:32,worldSmokePressure:8,worldSmokeExtent:4,worldSmokeIntermediate:'fields',intermediateFlow:24,intermediateMaterial:48,intermediatePressure:12,intermediateExtent:1.5,intermediateIterations:12};
test('draft plan exposes independent dimensions and actual spatial scale',()=>{
 const p=gridTuningPlan(c);assert.deepEqual(p.rows.map(r=>r.materialDims),[[64,128,64],[48,80,48],[32,64,32]]);
 assert.match(gridTuningSummary(p.rows[1],64),/cell width 2× fine material/);
 assert.match(gridTuningSummary(p.rows[0],64),/98,304 cell-iterations/);
 assert.deepEqual(gridWidthChoices(c,'finePressure'),[2,4,8,16,32]);
});
test('incompatible intermediate widths have constructive coverage choices',()=>{
 const d={...c,intermediateMaterial:32};assert.throws(()=>gridTuningPlan(d),/tile/);
 const choices=intermediateCoverageChoices(d);assert.ok(choices.includes(2));
 for(const e of choices)assert.doesNotThrow(()=>gridTuningPlan({...d,intermediateExtent:e}));
 assert.equal(d.intermediateExtent,1.5,'Offering a fit never changes authored coverage');
});
test('active dimensions and GPU limits reject; dormant middle does not block',()=>{
 for(const patch of [{fineVelocity:7},{worldSmokePressure:7},{intermediateExtent:9},{intermediateIterations:-1}])assert.throws(()=>gridTuningPlan({...c,...patch}));
 assert.throws(()=>gridTuningPlan(c,{maxStorageBufferBindingSize:1024}),/GPU/);
 assert.throws(()=>gridTuningPlan(c,{maxTextureDimension3D:32}),/GPU/);
 assert.doesNotThrow(()=>gridTuningPlan({...c,worldSmokeIntermediate:'off',intermediateExtent:9}));
 assert.doesNotThrow(()=>gridTuningPlan({...c,worldSmoke:'off',worldSmokePressure:7}));
});

test('follow pressure shows the effective legacy plan and its fallback',()=>{
 const d={...c,fineVelocity:0,finePressure:0,pressureResolution:'half'};
 const p=gridTuningPlan(d);assert.deepEqual(p.rows[0].pressureDims,[32,64,32]);
 assert.match(gridTuningSummary(p.rows[0],64),/786,432 cell-iterations/);
 const fallback=gridTuningPlan({...d,pressureSolver:'legacy'});
 assert.deepEqual(fallback.rows[0].pressureDims,[64,128,64]);
 assert.match(gridTuningSummary(fallback.rows[0],64),/requires-converged-pressure/);
 assert.throws(()=>gridTuningPlan({...d,finePressure:16,pressureSolver:'legacy'}),/requires-converged-pressure/);
});
