// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseFineCoverage, FineCoverageController, checkedFineCoverageOptions, sourceCoverageBounds} from '../volume-fine-coverage.mjs';
const box=(id,c,w=.1,weight=1)=>({id,lo:c.map(x=>x-w),hi:c.map(x=>x+w),weight});
const input=(sources,extra={})=>({frame:{translate:[0,0,0],scale:1},dims:[32,64,32],world:{lo:[-4,-4,-4],hi:[4,12,4]},sources,demand:[],...extra});
const opts={mode:'sources',margin:.15,headroom:.75,lookahead:0,interval:.25,activityWeight:1,hysteresis:.05};
test('explicit manual placement holds even before the first observation, then a source edit releases it',()=>{
 const c=new FineCoverageController(),i=input([box('a',[2,0,0])]);
 assert.equal(typeof c.hold,'function','manual native placement needs an explicit hold');c.hold(i.frame);
 assert.equal(c.update(i,opts,0).status,'manual-hold');assert.equal(c.update(i,opts,.5).target,null);
 assert.notEqual(c.update({...i,sources:[box('a',[3,0,0])]},opts,1).status,'manual-hold');
});
test('upward movement raises fixed-size coverage before the source meets the ceiling',()=>{
 const result=chooseFineCoverage(input([box('one',[0,2.5,0])]),opts);
 assert.ok(result.target,'coverage must move');assert.ok(result.target.translate[1]>1);
 assert.equal(result.target.scale,1);assert.equal(result.sourceCoverage,1);
});
test('source motion inside the interior margin incurs no remap',()=>{
 assert.equal(chooseFineCoverage(input([box('one',[.1,0,0])]),opts).target,null);
});
test('authored Headroom changes reframe equally covered sources and settle without repeated remaps',()=>{
 const c=new FineCoverageController(),i=input([box('one',[0,0,0])]);
 assert.equal(c.update(i,opts,0).target,null);
 const edited={...opts,headroom:.5};
 assert.equal(c.due(edited,.1),false,'editing must retain the configured minimum check interval');
 assert.equal(c.due(edited,.25),true);
 const r=c.update(i,edited,.25);
 assert.ok(r.target,'the authored headroom must move an already covered source');
 assert.equal(r.target.translate[1],-1);assert.equal(r.sourceCoverage,1);assert.equal(r.target.scale,1);
 assert.equal(r.cause,'headroom-edit');assert.equal(r.gain,0,'coverage is retained, not invented as a gain');
 c.accept(r.target,.25);
 assert.equal(c.update({...i,frame:r.target},edited,.5).target,null,'accepted headroom must not keep remapping');
});
test('a pending Headroom placement survives a refused move until the consumer accepts it',()=>{
 const c=new FineCoverageController(),i=input([box('one',[0,0,0])]);c.update(i,opts,0);
 const edited={...opts,headroom:.5},first=c.update(i,edited,.25);assert.ok(first.target);
 const retry=c.update(i,edited,.5);assert.deepEqual(retry.target,first.target,'no accept means the old box remains and the edit must retry');
 c.accept(retry.target,.5);assert.equal(c.update({...i,frame:retry.target},edited,.75).target,null);
});
test('live headroom preserves higher-priority covered fire instead of silently discarding it',()=>{
 const c=new FineCoverageController(),i=input([box('one',[0,0,0])],{demand:[box('fire',[0,2,0],.1)]}),fire={...opts,mode:'fire',activityWeight:2};
 c.update(i,fire,0);const r=c.update(i,{...fire,headroom:.5},.25);
 assert.equal(r.target,null);assert.equal(r.sourceCoverage,1);assert.equal(r.activityCoverage,1);
 assert.equal(r.headroomPending,true,'demand-constrained headroom remains explicit');
});
test('blocked headroom resumes when fire clears; manual placement overrides the pending request',()=>{
 const c=new FineCoverageController(),i=input([box('one',[0,0,0])],{demand:[box('fire',[0,2,0])]}),fire={...opts,mode:'fire',activityWeight:2};
 c.update(i,fire,0);const edited={...fire,headroom:.5};
 assert.equal(c.update(i,edited,.25).target,null);
 const cleared={...i,demand:[]};const r=c.update(cleared,edited,.5);assert.ok(r.target);assert.equal(r.target.translate[1],-1);
 c.accept(r.target,.5);assert.equal(c.update({...cleared,frame:r.target},edited,.75).target,null);
 const manual={...cleared,frame:{translate:[0,1,0],scale:1}};
 assert.equal(c.update(manual,edited,1).status,'manual-hold');
 assert.equal(c.update(manual,edited,1.25).target,null);
});
test('sub-cell headroom edits settle and re-enabling coverage checks immediately',()=>{
 const c=new FineCoverageController(),i=input([box('one',[0,0,0])]);c.update(i,opts,0);
 const edited={...opts,headroom:.751};const r=c.update(i,edited,.25);
 assert.equal(r.target,null);assert.equal(r.headroomPending,false);
 c.release();assert.equal(c.due(edited,.26),true);
});
test('a sub-threshold coverage gain cannot strand a feasible Headroom edit',()=>{
 const c=new FineCoverageController(),i=input([{id:'one',lo:[.50625,-.1,-.1],hi:[.70625,.1,.1],weight:1}]);
 const before=c.update(i,opts,0),edited={...opts,headroom:.5},r=c.update(i,edited,.25);
 assert.ok(r.target,'a nondegrading Headroom placement must survive ordinary movement hysteresis');
 assert.equal(r.target.translate[1],-1);assert.equal(r.cause,'headroom-edit');assert.ok(r.sourceCoverage>=before.sourceCoverage);
 assert.ok(r.gain<opts.hysteresis,'this case exercises the explicit Headroom path');
 c.accept(r.target,.25);assert.equal(c.update({...i,frame:r.target},edited,.5).target,null);
});
test('fixed World bounds contain every proposed Fine box',()=>{
 const r=chooseFineCoverage(input([box('one',[10,10,0])]),opts);
 if(r.target){const t=r.target.translate;assert.ok(t[0]<=3);assert.ok(t[1]<=9);}
 assert.equal(r.worldLimited,true);assert.ok(r.sourceCoverage<1);
});
test('separated emitters do not force a larger box or an empty midpoint',()=>{
 const r=chooseFineCoverage(input([box('a',[-2,0,0]),box('b',[2,0,0])]),opts);
 assert.equal(r.target.scale,1);assert.ok(Math.abs(r.target.translate[0])>1);assert.ok(r.sourceCoverage>=.49);
});
test('activity can retain attention after all emitters are removed',()=>{
 const r=chooseFineCoverage(input([],{demand:[box('fire',[2,4,0],.2)]}),{...opts,mode:'fire'});
 assert.ok(r.target);assert.ok(r.activityCoverage>.9);
 assert.equal(chooseFineCoverage(input([],{demand:[box('fire',[2,4,0],.2)]}),opts).target,null);
});
test('zero fire priority remains zero after the last source is removed',()=>{
 const i=input([],{demand:[box('gas',[2,4,0],.2)]});
 assert.equal(chooseFineCoverage(i,{...opts,mode:'fire',activityWeight:0}).target,null);
 assert.ok(chooseFineCoverage(i,{...opts,mode:'fire',activityWeight:1}).target);
});
test('authored supply edits release manual hold, while puff modulation does not',()=>{
 const c=new FineCoverageController();
 const sources=[{...box('a',[0,0,0],.1,10),authoredSupply:'speed=10'},{...box('b',[2,0,0],.1,1),authoredSupply:'speed=1'}];
 c.update(input(sources),opts,0);
 const manual=input(sources,{frame:{translate:[-.5,0,0],scale:1}});
 assert.equal(c.update(manual,opts,1).status,'manual-hold');
 const puffed=sources.map(s=>({...s,weight:s.weight*.8}));
 assert.equal(c.update({...manual,sources:puffed},opts,2).status,'manual-hold');
 const edited=[{...sources[0],weight:1,authoredSupply:'speed=1'},{...sources[1],weight:100,authoredSupply:'speed=100'}];
 const result=c.update({...manual,sources:edited},opts,3);
 assert.equal(result.status,'move');assert.equal(result.target.translate[0],2);
});
test('source hold identity excludes dynamic puff and coverage-relative centre',()=>{
 const e={admitted:true,centreCells:[16,16,16],direction:[0,1,0],radiusCells:4,thickness:2,fullFlux:8};
 const read=(speed,puffFactor,centre)=>sourceCoverageBounds({sources:[{id:'a',worldSource:true,config:{effective:e,requested:{speed,puffFactor,centre}}}]},{dims:[32,64,32],frame:{translate:[0,0,0],scale:1}})[0];
 assert.ok(read(1,1,[0,0,0]).authoredSupply);
 assert.equal(read(1,1,[0,0,0]).authoredSupply,read(1,.6,[0,2,0]).authoredSupply);
 assert.notEqual(read(1,1,[0,0,0]).authoredSupply,read(2,1,[0,0,0]).authoredSupply);
});
test('activity tradeoff preserves all samples and can prioritize a detached flame',()=>{
 const i=input([box('source',[0,0,0])],{demand:[box('fire',[2.5,4,0],.2)]});
 assert.equal(chooseFineCoverage(i,{...opts,mode:'fire',activityWeight:0}).target,null);
 assert.ok(chooseFineCoverage(i,{...opts,mode:'fire',activityWeight:5}).target);
});
test('prediction buys coverage before the current source leaves the interior',()=>{
 const i=input([{...box('source',[.5,0,0]),motionMin:[3,0,0],motionMax:[3,0,0]}]);
 assert.equal(chooseFineCoverage(i,opts).target,null);
 assert.ok(chooseFineCoverage(i,{...opts,lookahead:.4}).target);
});
test('no forced motion when source coverage is equally good; hysteresis rejects marginal gain',()=>{
 const i=input([box('source',[0,0,0])],{demand:[box('fire',[2,4,0],.2)]});
 assert.equal(chooseFineCoverage(i,{...opts,mode:'fire',activityWeight:.01,hysteresis:.05}).target,null);
});
test('invalid options or nonfinite fields fail instead of hiding a disabled fallback',()=>{
 for(const patch of [{margin:.5},{margin:-1},{interval:-1},{lookahead:NaN},{mode:'resize'},{headroom:2}])assert.throws(()=>checkedFineCoverageOptions(patch));
 assert.throws(()=>chooseFineCoverage(input([box('bad',[NaN,0,0])]),opts),/finite/i);
});
test('cadence coalesces latest demand, and manual movement holds until source or policy changes',()=>{
 const c=new FineCoverageController(),i=input([box('a',[2,0,0])]);
 let r=c.update(i,opts,0);assert.ok(r.target);c.accept(r.target,0);
 const moved={...i,frame:r.target,sources:[box('a',[-2,0,0])]};
 assert.equal(c.due(opts,.1),false);
 r=c.update(moved,opts,.3);assert.ok(r.target);c.accept(r.target,.3);
 const manual={...moved,frame:{translate:[0,2,0],scale:1}};
 r=c.update(manual,opts,.6);assert.equal(r.target,null);assert.equal(r.status,'manual-hold');
 r=c.update({...manual,sources:[box('a',[2,0,0])]},opts,.9);assert.notEqual(r.status,'manual-hold');
});
test('complete source support includes sources entirely inside Fine and handles rotated slabs',()=>{
 const e={admitted:true,centreCells:[16,16,16],direction:[1,0,0],radiusCells:4,thickness:2,fluxRequested:8,fuel:1,temperature:1};
 const out=sourceCoverageBounds({sources:[{id:'a',worldSource:true,config:{effective:e}}]},{dims:[32,64,32],frame:{translate:[1,2,3],scale:2}});
 assert.equal(out.length,1);assert.equal(out[0].id,'a');assert.ok(out[0].hi[1]-out[0].lo[1]>out[0].hi[0]-out[0].lo[0]);
 assert.deepEqual(out[0].lo.map((v,a)=>(v+out[0].hi[a])/2),[1,2,3]);
});
test('coverage controls are additive domain settings in both scene and basin documents',async()=>{
 const {readFileSync}=await import('node:fs');
 const {buildSceneDocument,planSceneRestore}=await import('../scene-persistence-core.js');
 const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
 const ids=['mode','margin','headroom','lookahead','interval','activity-weight','hysteresis'].map(k=>'volume-coverage-'+k);
 const fields=ids.map(id=>{const field=schema.controls.find(f=>f.key===id);assert.ok(field,`missing saved coverage setting ${id}`);return field;});
 assert.equal(fields[0].additiveDefault,'off');
 const domControls=Object.fromEntries(fields.map(f=>[f.key,{id:f.key,param:f.param,tagName:f.tagName,type:f.type,value:f.key.endsWith('-mode')?'fire':0}]));
 const settings={domControls,rendererControls:{},presentationControls:{}};
 const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:`vsp-${'a'.repeat(64)}`,stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
 const doc=JSON.parse(JSON.stringify(buildSceneDocument({objects:[],composition,fireSettings:settings})));
 assert.deepEqual(planSceneRestore(doc).fireSettings,settings);
});
test('World source supply remains a placement target after its overlap with Fine reaches zero',()=>{
 // Native WebGPU consumer02, b7c2e8a36: source moved to world y=2.84.
 // The solver reports zero Fine flux but continuing full World supply.
 const e={admitted:true,centreCells:[16,73.44,16],direction:[0,1,0],radiusCells:8,thickness:3.99,fluxRequested:0,fullFlux:116.97773272001578};
 const sources=sourceCoverageBounds({sources:[{id:'flame-emitter',worldSource:true,config:{effective:e}}]},{dims:[32,64,32],frame:{translate:[0,-.75,0],scale:1}});
 assert.equal(sources.length,1,'World supply cannot disappear from the placement objective outside Fine');
 assert.equal(sources[0].weight,e.fullFlux);
 assert.ok(chooseFineCoverage(input(sources,{frame:{translate:[0,-.75,0],scale:1}}),opts).target.translate[1]>1);
});
