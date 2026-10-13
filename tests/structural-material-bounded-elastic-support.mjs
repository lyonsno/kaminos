import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as fragments from '../structural-material-bounded-fragments.mjs';
import {reconstructStoneObservation} from '../structural-material-observation-economics.mjs';

const positions=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra=[[0,1,2,3]],pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
const bonds=pairs.flatMap(([a,b],i)=>[a,b,Number(i!==0&&i!==1&&i!==2),0]);
test('zero-elastic cells do not tie independently moving parents together',()=>{
 assert.equal(typeof fragments.elasticSupportBonds,'function','Derived elastic support connectivity is required');
 const before=[...bonds],effective=fragments.elasticSupportBonds(tetrahedra,bonds,[{active:false}]);
 assert.deepEqual(bonds,before,'Do not mutate stress-fracture liveness');
 assert.deepEqual(effective.filter((_,i)=>i%4===2),[0,0,0,0,0,0]);
 assert.deepEqual(effective.filter((_,i)=>i%4===3),[0,0,0,1,1,1],'Keep original edge state separately for the journal');
 const shell=fragments.buildFixedCellShell({positions,tetrahedra,bonds}),current=positions.map((p,i)=>p.map((v,k)=>v+(i===1&&k===0?100:0))),posed=fragments.applyFixedCellShell(shell.binding,current,effective);
 for(let i=0;i<posed.length;i++)assert.deepEqual(posed[i],shell.binding.entries[i].rest.map((v,k)=>v+(shell.binding.entries[i].anchor===1&&k===0?100:0)),'A released cell translates without a spike');
});
test('active support preserves only actual live edges and validates complete input',()=>{
 assert.equal(typeof fragments.elasticSupportBonds,'function','Derived elastic support connectivity is required');
 const effective=fragments.elasticSupportBonds(tetrahedra,bonds,[{active:true}]);
 assert.deepEqual(effective.filter((_,i)=>i%4===2),bonds.filter((_,i)=>i%4===2));
 assert.throws(()=>fragments.elasticSupportBonds(tetrahedra,bonds,[]),/complete/i);
});
test('support-aware observations cannot silently lose their material-cell resource',()=>{
 const dynamic={runId:'run',pieces:[],state:{model:{elements:1,points:4}},materialRegime:{connectivity:'kaminos.bounded-connectivity.elastic-support.v1'}},resource={schema:'stone-observation-resource-v1',version:'run',pieces:[]};
 assert.throws(()=>reconstructStoneObservation(dynamic,resource),/elastic support/i);
 const complete={...resource,elasticSupport:{route:dynamic.materialRegime.connectivity,elements:tetrahedra}};
 assert.deepEqual(reconstructStoneObservation(dynamic,complete).elasticSupport,complete.elasticSupport);
});
