// kaminos-test: node
import assert from 'node:assert/strict';
import {makeStudyState,runOverlapCase,overlapCases} from '../granular-overlap.mjs';
const specimen=makeStudyState({fineCount:4,fineSolidVolume:1e-8,settleSeconds:.01,localSeconds:.005,passes:1,stages:1,grids:[[2,2]],overlapDiameters:[.5]});
const steps=[];const whole=await runOverlapCase(specimen.state,{...specimen,caseDefinition:overlapCases(specimen.configuration)[0],onStep:step=>steps.push(step)});
assert.ok(steps.some(step=>step.phase==='settle'),'local preparation must settle from the common unprepared inventory before compression');
assert.ok(steps.findIndex(step=>step.phase==='settle')<steps.findIndex(step=>step.phase==='compress'));
assert.equal(whole.loading.fineTops.length,specimen.fineIds.length);
const patch=await runOverlapCase(specimen.state,{...specimen,caseDefinition:overlapCases(specimen.configuration)[1],loading:whole.loading});
assert.deepEqual(patch.loading,whole.loading,'every case must use the same reference-derived loading planes');
assert.equal(patch.state.time,specimen.state.time);
