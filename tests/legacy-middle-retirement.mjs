// kaminos-test: node
import assert from 'node:assert/strict';
import {resolveWorldRegions,REGION_CONTROL_FIELDS} from '../volume-region-controls.mjs';
import {GRID_TUNING_GROUPS,GRID_TUNING_FIELDS,gridTuningPlan} from '../volume-grid-tuning.mjs';
const controls={resolution:16,gridHeightRatio:2,worldSmoke:'on',worldSmokeFlow:8,worldSmokeMaterial:8,worldSmokePressure:4,worldSmokeIterations:12,pressureSolver:'converged-open-top',pressureSolverIterations:12};
const old={...controls,worldSmokeIntermediate:'fields',intermediateFlow:6,intermediateMaterial:6,intermediatePressure:3,intermediateIterations:4,intermediateExtent:1.5};
const expected=resolveWorldRegions(controls,[16,32,16]),restored=resolveWorldRegions(old,[16,32,16]);
assert.equal(Object.hasOwn(restored,'middle'),false,'Retired Middle configuration must not allocate or publish an intermediate region');
assert.deepEqual(restored,expected,'Old Middle settings must preserve the Fine/World plan without recreating the retired region');
assert.deepEqual(gridTuningPlan(old).rows.map(row=>row.name),['Fine','World']);
assert.equal(GRID_TUNING_GROUPS.some(group=>group.name.startsWith('Intermediate')),false,'Grid inspector exposes the supported Fine/World architecture');
assert.equal(GRID_TUNING_FIELDS.some(([,id])=>id.startsWith('volume-intermediate-')||id==='volume-world-smoke-intermediate'),false);
assert.equal(REGION_CONTROL_FIELDS.some(field=>field.key.startsWith('intermediate')),false);
console.log('Legacy Middle settings preserve Fine/World without an intermediate field or editable controls');
