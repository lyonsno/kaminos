// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createFireLightingHistory} from '../fire-lighting-history.mjs';
import {installSceneControlHistory} from '../scene-control-history.mjs';

function fixture(admit=()=>{}){
 let release,reject;
 const ready=new Promise((yes,no)=>{release=yes;reject=no;});
 ready.catch(()=>{});
 const source={
  value:{sourceGrid:16,transportQuality:{sourceSamplesPerAxis:2,fineSteps:0}},
  debugState(){return structuredClone(this.value);},
  whenRebuilt:()=>ready,
  setSourceGrid(value){this.value.sourceGrid=value;},
  setTransportQuality(value){
   if(value.sourceSamplesPerAxis!==undefined&&value.sourceSamplesPerAxis<1)throw Error('invalid quadrature');
   this.value.transportQuality={...this.value.transportQuality,...value};
  },
 };
 const edits=createSceneEdits({read:()=>null,write(){},admit});
 const history=createFireLightingHistory({edits,getSource:()=>source});
 return {source,edits,history,release,reject};
}

{
 let busy=false;
 const f=fixture(id=>{if(busy&&!id?.startsWith('@fire-lighting:'))throw Error('authoring busy');});
 const first=f.history.run('setTransportQuality',{sourceSamplesPerAxis:3});
 busy=true;
 const next=f.history.run('setTransportQuality',{fineSteps:12});next.catch(()=>{});
 assert.equal(f.source.value.transportQuality.fineSteps,12,'target-aware admission permits further lighting requests during compilation');
 assert.throws(()=>f.edits.begin('@other'),/authoring busy/,'ordinary placement stays protected');
 const undo=f.edits.undo();assert.equal(f.source.value.transportQuality.fineSteps,0);
 f.release();await Promise.all([first,next,undo]);
}

{
 const f=fixture();
 const update=f.history.run('setTransportQuality',{sourceSamplesPerAxis:3});
 update.catch(()=>{});
 assert.equal(f.source.value.transportQuality.sourceSamplesPerAxis,3,'request reaches its consumer immediately');
 assert.equal(f.edits.state().active,null,'shader preparation must not retain the global scene edit');
 assert.equal(f.edits.state().undoCount,1,'accepted request is undoable while replacement lighting prepares');
 let value=1;const errors=[];
 f.edits.register('@flame-gesture',{read:()=>({value}),check:x=>x,write:x=>{value=x.value;}});
 const control=new EventTarget();control.type='number';
 const gesture=installSceneControlHistory({controls:[control],edits:f.edits,id:'@flame-gesture',onError:e=>errors.push(e.message)});
 control.dispatchEvent(new Event('focusin'));value=2;control.dispatchEvent(new Event('change'));
 assert.deepEqual(errors,[],'another real control gesture is not refused by pending lighting');
 assert.equal(f.edits.state().undoCount,2);
 f.release();await update;assert.equal(f.edits.state().active,null);
 await f.edits.undo();assert.equal(value,1);
 await f.edits.undo();assert.equal(f.source.value.transportQuality.sourceSamplesPerAxis,2);
 await f.edits.redo();assert.equal(f.source.value.transportQuality.sourceSamplesPerAxis,3);
 gesture.dispose();
}

{
 const f=fixture(),requests=[
  f.history.run('setTransportQuality',{sourceSamplesPerAxis:3}),
  f.history.run('setTransportQuality',{fineSteps:12}),
  f.history.run('setSourceGrid',8),
 ];
 requests.forEach(p=>p.catch(()=>{}));
 assert.deepEqual(f.source.value,{sourceGrid:8,transportQuality:{sourceSamplesPerAxis:3,fineSteps:12}},
  'overlapping requests merge against current desired state without lost fields');
 assert.equal(f.edits.state().undoCount,3);
 assert.equal(f.edits.state().active,null);
 f.release();await Promise.all(requests);
 await f.edits.undo();assert.equal(f.source.value.sourceGrid,16);
 await f.edits.undo();assert.deepEqual(f.source.value.transportQuality,{sourceSamplesPerAxis:3,fineSteps:0});
 await f.edits.undo();assert.deepEqual(f.source.value.transportQuality,{sourceSamplesPerAxis:2,fineSteps:0});
 for(let i=0;i<3;i++)await f.edits.redo();
 assert.deepEqual(f.source.value,{sourceGrid:8,transportQuality:{sourceSamplesPerAxis:3,fineSteps:12}});
}

{
 const f=fixture(),update=f.history.run('setTransportQuality',{sourceSamplesPerAxis:3});
 const undo=f.edits.undo();
 assert.equal(f.source.value.transportQuality.sourceSamplesPerAxis,2,'undo applies during preparation');
 assert.equal(f.edits.state().replaying,true);
 f.release();await Promise.all([update,undo]);
 assert.equal(f.edits.state().undoCount,0);assert.equal(f.edits.state().redoCount,1);
 assert.equal(f.source.value.transportQuality.sourceSamplesPerAxis,2,'older completion cannot resurrect an undone request');
}

{
 const f=fixture();
 await assert.rejects(f.history.run('setTransportQuality',{sourceSamplesPerAxis:0}),/invalid quadrature/);
 assert.equal(f.edits.state().active,null);assert.equal(f.edits.state().undoCount,0);
 const update=f.history.run('setTransportQuality',{sourceSamplesPerAxis:3});
 f.reject(Error('kernel rejected'));await assert.rejects(update,/kernel rejected/);
 assert.equal(f.edits.state().active,null,'preparation failure cannot strand the scene transaction');
 assert.equal(f.edits.state().undoCount,1,'failed presentation retains an undoable desired request');
 f.source.whenRebuilt=()=>Promise.resolve();
 await f.edits.undo();assert.equal(f.source.value.transportQuality.sourceSamplesPerAxis,2);
}
console.log('PASS lighting request history remains editable during preparation, failure and replay');
