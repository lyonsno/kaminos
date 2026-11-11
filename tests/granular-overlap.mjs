// kaminos-test: node
import assert from 'node:assert/strict';
import {overlapCases,patchWindows} from '../granular-overlap.mjs';
const cases=overlapCases({grids:[[2,2],[2,4]],overlapDiameters:[1,2]});
assert.equal(cases.length,9,'comparison needs a whole specimen plus fixed/shifted four/eight-region cases at both overlaps');
assert.equal(new Set(cases.map(x=>x.id)).size,9);
const windows=patchWindows({width:.024,grid:[2,2],overlap:.002,offset:[0,0]});
assert.equal(windows.length,4,'four-region grid must contain a four-way junction');
const shifted=patchWindows({width:.024,grid:[2,2],overlap:.002,offset:[.25,-.25]});assert.notDeepEqual(shifted.map(w=>w.core),windows.map(w=>w.core));
for(const x of [-.011,-.006,0,.006,.011])for(const z of [-.011,-.006,0,.006,.011])assert.ok(shifted.some(w=>x>=w.bounds[0]&&x<=w.bounds[1]&&z>=w.bounds[2]&&z<=w.bounds[3]),'shifted windows must cover the entire specimen');
assert.ok(windows.filter(w=>0>=w.bounds[0]&&0<=w.bounds[1]&&0>=w.bounds[2]&&0<=w.bounds[3]).length===4,'the overlap must exercise the four-way junction');
assert.throws(()=>patchWindows({width:.024,grid:[2,2],offset:[1,0]}),/offset/i);
const {makeStudyState,relaxPatch,runOverlapCase,studyConfiguration}=await import('../granular-overlap.mjs');
const small=makeStudyState({fineCount:4,fineSolidVolume:1e-8,settleSeconds:.01,stages:1,passes:2,localSeconds:.005,grids:[[2,2]],overlapDiameters:[1]});
const finer=makeStudyState({...small.configuration,fineCount:8});
const fineVolume=s=>s.state.ingredients.filter(g=>g.role==='fine').reduce((v,g)=>v+g.volume,0);
assert.ok(Math.abs(fineVolume(small)-fineVolume(finer))<1e-20,'refinement must preserve the amount of fine material');
const before=structuredClone(small.state),local=relaxPatch(before,{activeIds:[small.fineIds[0]],seconds:.005});
assert.deepEqual(local.state.ingredients,before.ingredients);assert.equal(local.state.time,before.time,'local relaxation must not advance the parent clock');
for(const row of before.grains)if(row.id!==small.fineIds[0])assert.deepEqual(local.state.grains[row.id],row,'local commit must preserve every frozen neighboring row');
const result=await runOverlapCase(before,{...small,caseDefinition:overlapCases(small.configuration)[2]});
assert.equal(result.state.grains.length,before.grains.length);assert.deepEqual(result.state.ingredients,before.ingredients);for(const id of small.anchorIds)assert.deepEqual(result.state.grains[id],before.grains[id]);
assert.ok(small.fineIds.every(id=>result.visits[id]>=small.configuration.passes));assert.equal(result.state.time,before.time);assert.ok(result.activeParticleSteps>0);
console.log('overlap layouts, moving junction, fixed-volume refinement, physical context and canonical state custody pass');
const {loadStudyState}=await import('../granular-overlap.mjs');
const bytes=new TextEncoder().encode(JSON.stringify(result.state));
const digest=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const artifact={path:'case.json',sha256:await digest(bytes)},caseId=result.state.overlapPreparation.case;
const initialBytes=new TextEncoder().encode(JSON.stringify(before)),initialArtifact={path:'initial.json',sha256:await digest(initialBytes)};
const definition=overlapCases(small.configuration).find(c=>c.id===caseId);
const manifest={schema:'kaminos.granular-overlap-study.v1',effectiveRoute:'cannon-es-0.20.0-cpu/convex-grains/frozen-neighbor-patches',source:{commit:'observed-local-fixture',dirty:''},configuration:small.configuration,anchorIds:small.anchorIds,nominalDiameter:small.nominalDiameter,initial:initialArtifact,geometrySha256:await digest(new TextEncoder().encode(JSON.stringify(result.state.ingredients))),cases:[{...definition,status:'completed',snapshot:artifact}]};
assert.deepEqual(await loadStudyState(manifest,artifact,caseId,async file=>file==='initial.json'?initialBytes:bytes),result.state);
await assert.rejects(loadStudyState({...manifest,effectiveRoute:'fallback'},artifact,caseId,async file=>file==='initial.json'?initialBytes:bytes),/route/i);
await assert.rejects(loadStudyState({...manifest,cases:[{...manifest.cases[0],status:'running'}]},artifact,caseId,async file=>file==='initial.json'?initialBytes:bytes),/incomplete/i);
await assert.rejects(loadStudyState(manifest,{...artifact,sha256:'wrong'},caseId,async file=>file==='initial.json'?initialBytes:bytes),/incomplete|hash/i);
const wrongCase=structuredClone(result.state);wrongCase.overlapPreparation.case='whole';const wrongBytes=new TextEncoder().encode(JSON.stringify(wrongCase)),wrongArtifact={path:'wrong.json',sha256:await digest(wrongBytes)};
await assert.rejects(loadStudyState({...manifest,cases:[{...definition,status:'completed',snapshot:wrongArtifact}]},wrongArtifact,caseId,async()=>wrongBytes),/case identity/i);
await assert.rejects(loadStudyState(manifest,artifact,caseId,async()=>new Uint8Array()),/hash/i);
const changedGeometry=structuredClone(result.state);changedGeometry.ingredients[2].vertices[0][0]+=.00001;const changedBytes=new TextEncoder().encode(JSON.stringify(changedGeometry)),changedArtifact={path:'changed.json',sha256:await digest(changedBytes)};
await assert.rejects(loadStudyState({...manifest,cases:[{...definition,status:'completed',snapshot:changedArtifact}]},changedArtifact,caseId,async()=>changedBytes),/geometry/i);
for(const mutation of [m=>delete m.configuration,m=>m.anchorIds={},m=>delete m.cases,m=>delete m.nominalDiameter]){const bad=structuredClone(manifest);mutation(bad);await assert.rejects(loadStudyState(bad,artifact,caseId,async file=>file==='initial.json'?initialBytes:bytes),e=>e instanceof Error&&!(e instanceof TypeError)&&/manifest|configuration|anchor|case|diameter/i.test(e.message),'malformed metadata must give an explicit admission error');}

for(const edit of [state=>state.grains[0].position[0]+=.0001,state=>state.time+=.01]){const bad=structuredClone(result.state);edit(bad);const badBytes=new TextEncoder().encode(JSON.stringify(bad)),badArtifact={path:'bad.json',sha256:await digest(badBytes)};await assert.rejects(loadStudyState({...manifest,cases:[{...definition,status:'completed',snapshot:badArtifact}]},badArtifact,caseId,async file=>file==='initial.json'?initialBytes:badBytes),/anchor|clock/i);}
const defaultSpecimen=makeStudyState();assert.ok(defaultSpecimen.configuration.width/4/defaultSpecimen.nominalDiameter>=3.9,'eight-region cells need several constituents across');assert.ok(Math.max(...defaultSpecimen.configuration.overlapDiameters)*defaultSpecimen.nominalDiameter<defaultSpecimen.configuration.width/4,'overlap must not swallow the shortest cell in the chosen specimen');
