// kaminos-test: node
import assert from 'node:assert/strict';
import {makeStudyState,runOverlapCase,overlapCases} from '../granular-overlap.mjs';
import {preparationSource} from '../granular-preparation.mjs';
const specimen=makeStudyState({fineCount:4,fineSolidVolume:1e-8,settleSeconds:.01,localSeconds:.005,stages:0,passes:2,commitPolicy:'core',grids:[[2,2]],overlapDiameters:[1]});
const source=preparationSource(specimen.state);for(const id of specimen.anchorIds){const top=Math.max(...source.triangles.filter(t=>t.identity===`grain-${id}`).flatMap(t=>[t.a[1],t.b[1],t.c[1]]));assert.ok(top>specimen.nominalDiameter*.74&&top<specimen.nominalDiameter*.76,'each parent must expose a geometry-derived relief above the floor');}
const commits=new Map(),replay=structuredClone(specimen.state);
const result=await runOverlapCase(specimen.state,{...specimen,caseDefinition:overlapCases(specimen.configuration)[2],onStep(step,state){const key=[step.phase,step.stage,step.pass].join(':');const ids=commits.get(key)??[];ids.push(...step.commitIds);commits.set(key,ids);for(const id of step.commitIds)replay.grains[id]=structuredClone(state.grains[id]);replay.lidHeight=state.lidHeight;}});
for(const ids of commits.values())assert.deepEqual([...ids].sort((a,b)=>a-b),specimen.fineIds,'each fine grain must be committed exactly once per pass');
assert.deepEqual(replay.grains,result.state.grains);assert.equal(replay.lidHeight,result.state.lidHeight);
