// kaminos-test: node
import assert from 'node:assert/strict';
import * as E from '../experiments/link-workshop/elaboration.mjs';
assert.equal(typeof E.segmentDistance,'function','Elaboration needs a geometric same-time encounter witness');
const crossing=E.segmentDistance([-1,0,0],[1,0,0],[0,-1,0],[0,1,0]);assert.equal(crossing.distance,0);assert.deepEqual(crossing.a,[0,0,0]);assert.deepEqual(crossing.b,[0,0,0]);assert.equal(E.segmentDistance([0,0,0],[0,0,0],[1,0,0],[2,0,0]).distance,1);
const m=E.elaborationFixture();const report=E.scanInteractions(m);assert.ok(report.encounters.some(x=>x.a.piston!==undefined&&x.b.piston!==undefined&&x.status==='contact'));const incident=report.encounters.find(x=>x.a.piston!==undefined&&x.b.piston!==undefined);assert.ok(incident.fraction>=0&&incident.fraction<=1);assert.ok(incident.distance<incident.requiredDistance);
const out=E.proposeElaboration(m,incident,{kind:'outboard'});assert.deepEqual(out.recipe.nodes,m.nodes,'Outboard construction preserves requested bodies and motion');assert.equal(out.recipe.pistons.length,m.pistons.length);assert.equal(E.scanInteractions(out.recipe).encounters.length,0,'Axial separation clears the tested tube/rail shapes throughout the authored motion');
const carrier=E.proposeElaboration(m,incident,{kind:'carrier',piston:1});assert.equal(carrier.recipe.nodes.length,m.nodes.length+1);assert.deepEqual(carrier.recipe.nodes.slice(0,m.nodes.length),m.nodes,'Structural refinement preserves the original requested panel motion');assert.equal(carrier.recipe.nodes.at(-1).parent,1);assert.equal(carrier.recipe.pistons[1].b,carrier.recipe.nodes.length-1);
const committed=E.adoptElaboration(m,out);assert.equal(committed.elaboration.steps.length,1);assert.deepEqual(committed.elaboration.intent.nodes,m.nodes);assert.throws(()=>E.adoptElaboration({...m,period:m.period+1},out),/changed/i,'A proposal cannot land on a changed construction');
assert.equal(E.adoptElaboration(committed,E.proposeElaboration(committed,null,{kind:'carrier',piston:1})).elaboration.steps.length,2,'A later elaboration preserves prior lineage');
console.log('Same-time encounters, two structural continuations, retained action and recursive lineage');

assert.equal(incident.sourceKey,report.sourceKey,'Each encounter retains exact construction identity');
assert.throws(()=>E.proposeElaboration({...m,period:6},incident,{kind:'outboard'}),/changed/i);
const tampered=structuredClone(out);tampered.recipe.nodes[1].angles[0]+=.1;assert.throws(()=>E.adoptElaboration(m,tampered),/preserv|proposal/i,'Adoption cannot alter retained requested action');
