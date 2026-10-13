import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createBasinFireFixture} from '../basin-fire-fixture.mjs';
import * as fireFixture from '../basin-fire-fixture.mjs';

test('a fire fixture applies the whole basin and reuses its real scene source',async()=>{
  const calls=[],events=[];let registered=false,visible=false,emissionEnabled=true;
  const initial={domControls:{'volume-flow-rate':{value:1},temperature:{value:2000}},source:null};
  let state=structuredClone(initial);
  const basins={read:()=>structuredClone(state),apply:next=>{state=structuredClone(next);calls.push('settings');},
    async applyBasin(id){state={domControls:{'volume-flow-rate':{value:2.5},temperature:{value:2200}},source:{presetId:id,label:'Saved 48 basin'}};calls.push('whole-basin');},
    openLibrary:()=>calls.push('library')};
  const source={read:()=>({registered,registrationId:registered?'root-1':null,emissionEnabled,pose:[1,0,0]}),setEnabled:value=>{emissionEnabled=value;},ensure:()=>{registered=true;calls.push('register');return 'fire-1';},
    select:id=>calls.push(['select',id]),remove:()=>{registered=false;calls.push('remove');}};
  const runtime={setSimulationPaused:value=>calls.push(['paused',value]),setActive:async()=>calls.push('activate'),debugState:()=>({simGrid:48,active:true})};
  const presentation={read:()=>visible,set:value=>{visible=value;}};
  const f=await createBasinFireFixture({basins,source,runtime,presentation,record:event=>events.push(event)},{presetId:'saved48',enabled:false,pauseOnCreate:true});
  assert.equal(f.read().basin.presetId,'saved48');assert.equal(f.read().enabled,false);assert.equal(f.read().visible,true);
  assert.equal(state.domControls['volume-flow-rate'].value,2.5,'source activity must not rewrite the saved basin Flow');
  assert.equal(state.domControls.temperature.value,2200);f.setEnabled(true);assert.equal(f.read().flow,2.5);
  state.domControls['volume-flow-rate'].value=1.75;f.setEnabled(false);f.setEnabled(true);assert.equal(f.read().flow,1.75);
  f.select();f.showLibrary();assert.deepEqual(source.read().pose,[1,0,0]);
  f.dispose();f.dispose();assert.equal(calls.filter(c=>c==='remove').length,1);assert.equal(visible,false);
  assert.throws(()=>f.setEnabled(true),/disposed/);assert.ok(events.every(event=>event.target==='fire-1'));
});

test('the log uses normal scene placement, not a private contact slider',async()=>{
  const source=await fs.readFile(new URL('../live-log-experiment.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/data-position="x"/,'private contact slider bypasses the normal scene-authoring interaction');
  assert.doesNotMatch(source,/data-flame-view/,'fire visibility belongs to its reusable fixture, not the log panel');
});

test('a named basin cannot be substituted and a replaced scene source is not owned',async()=>{
  let state={domControls:{'volume-flow-rate':{value:2},'volume-resolution':{value:48}},source:{presetId:'before'}};
  let registered=false,registrationId=null,removed=0;
  const source={read:()=>({registered,registrationId}),ensure:()=>{registered=true;registrationId='original-root';return 'fire';},select(){},remove(){removed++;registered=false;}};
  const host={basins:{read:()=>structuredClone(state),apply:next=>{state=structuredClone(next);},inspect:async()=>({...state,source:{presetId:'wanted'}}),
    applyBasin:async()=>{state={...state,source:{presetId:'wrong'}};}},source,
    runtime:{setSimulationPaused(){},async setActive(){},debugState:()=>({active:true})},presentation:{read:()=>true,set(){}}};
  await assert.rejects(createBasinFireFixture(host,{presetId:'wanted',allowedGrids:[48]}),/basin identity/);
  assert.equal(state.source.presetId,'before');assert.equal(registered,false);
  host.basins.applyBasin=async id=>{state={...state,source:{presetId:id}};};
  const f=await createBasinFireFixture(host,{presetId:'wanted'});
  registrationId='replacement-root';assert.equal(f.read().status,'unavailable');assert.equal(f.read().enabled,null);
  assert.throws(()=>f.setEnabled(false),/registration changed/);
  source.ensure=()=>{registered=true;return 'fire';};source.setEnabled=()=>{};
  f.reacquire();assert.equal(f.read().status,'mounted');assert.equal(f.read().sourceRegistrationId,'replacement-root');
  f.dispose();assert.equal(removed,0,'explicitly borrowing a replacement does not acquire deletion ownership');
});

test('a refused basin load preserves a newer authoring edit',async()=>{
  let state={domControls:{'volume-flow-rate':{value:2}},source:{presetId:'before'}};
  const host={basins:{read:()=>structuredClone(state),apply:next=>{state=structuredClone(next);},
    async applyBasin(){state={domControls:{'volume-flow-rate':{value:7}},source:{presetId:'newer-edit'}};throw Error('The scene changed while the basin loaded');}},
    source:{read:()=>({registered:false}),ensure(){throw Error('must not register');}},
    runtime:{setSimulationPaused(){},async setActive(){},debugState:()=>({active:true})},presentation:{read:()=>true,set(){}}};
  await assert.rejects(createBasinFireFixture(host,{presetId:'requested'}),/scene changed/);
  assert.equal(state.source.presetId,'newer-edit');assert.equal(state.domControls['volume-flow-rate'].value,7);
});

test('source availability stays live without reading basin or renderer inspection state',async()=>{
  let state={domControls:{'volume-flow-rate':{value:2.5}},source:{presetId:'saved48'}};
  let registered=true,registrationId='root-1',emissionEnabled=true,inspectionReads=0;
  const inspect=()=>{inspectionReads++;};
  const fixture=await createBasinFireFixture({
    basins:{read(){inspect();return structuredClone(state);},modified(){inspect();return false;},async applyBasin(id){state.source.presetId=id;}},
    source:{read:()=>({registered,registrationId,emissionEnabled}),ensure:()=> 'fire-1',select(){},setEnabled(value){emissionEnabled=value;}},
    runtime:{async setActive(){},debugState(){inspect();return {active:true};}},
    presentation:{read(){inspect();return true;},set(){}},
  },{presetId:'saved48'});
  inspectionReads=0;
  assert.deepEqual(fixture.availability(),{status:'mounted',objectId:'fire-1',sourceRegistrationId:'root-1',enabled:true});
  emissionEnabled=false;assert.equal(fixture.availability().enabled,false);
  registered=false;assert.equal(fixture.availability().status,'unavailable');assert.equal(fixture.availability().enabled,null);
  registered=true;registrationId='replacement';assert.equal(fixture.availability().status,'unavailable');
  registrationId='root-1';assert.equal(fixture.availability().status,'mounted');
  assert.equal(inspectionReads,0,'registration checks must not construct settings, export URLs or runtime diagnostics');
  fixture.dispose();assert.equal(fixture.availability().status,'disposed');
});

test('the fire library reads the full index without refreshing another chooser',async()=>{
  const index={entries:[{presetId:'current'}],earlierVersions:[{presetId:'earlier'}],futureField:{retained:true}};
  const calls=[];
  const actual=await fireFixture.readBasinFireIndex({fetch:async(...args)=>{calls.push(args);return {ok:true,json:async()=>index};},validate:received=>assert.equal(received,index)});
  assert.equal(actual,index);assert.equal(actual.earlierVersions.length,1);assert.equal(actual.futureField.retained,true);
  assert.deepEqual(calls,[['/api/volume-settings-presets',{cache:'no-store'}]]);
  await assert.rejects(fireFixture.readBasinFireIndex({fetch:async()=>({ok:false,status:502,json:async()=>index}),validate(){throw Error('must reject HTTP failure first');}}),/502/);
  await assert.rejects(fireFixture.readBasinFireIndex({fetch:async()=>({ok:true,json:async()=>index}),validate(){throw Error('wrong schema');}}),/wrong schema/);
});
