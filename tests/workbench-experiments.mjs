import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestigationRecording} from '../investigation-recording.mjs';

const unavailable = () => {throw Error('Owner module entry is unavailable on the baseline');};
const {loadExperimentContributions = unavailable, openExperiment = unavailable} =
  await import('../workbench-experiments.mjs').catch(error => {
    if(error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/workbench-experiments.mjs'))return {};
    throw error;
  });

test('discovery loads definitions without creating a simulation; follow-up needs no central list', async () => {
  let starts=0;
  const modules=new Map([['/paper.experiment.mjs',{default:{id:'paper',title:'Finite water',create(){starts++;}}}]]);
  const loadModule=async url=>modules.get(url);
  assert.equal((await loadExperimentContributions([...modules.keys()],{loadModule}))[0].id,'paper');
  assert.equal(starts,0);
  modules.set('/hand.experiment.mjs',{default:{id:'hand',title:'Hand comparison',create(){starts++;}}});
  const second=await loadExperimentContributions([...modules.keys()],{loadModule});
  assert.deepEqual(second.map(row=>row.id),['paper','hand']);
  assert.equal(starts,0);
});

test('UI and agent invoke the same owner operations and explicit shared recording', async () => {
  const recording=createInvestigationRecording({id:'entry',source:{kind:'fixture'},initial:{beta:0},startingConditions:{kind:'fixture'}});
  let beta=0,reads=0,disposals=0;
  const host={name:'supplied-host'};
  const definition={id:'paper',title:'Finite water',create({host:provided,inputs,record}){
    assert.equal(provided,host);assert.equal(inputs.dt,1/240);
    const operations={setBeta(value){beta=value;const result={effective:{beta},requested:value};
      record({kind:'paper.beta',phase:'applied',target:'water',...result});return result;}};
    return {read(){reads++;return {beta,dt:inputs.dt};},operations,
      mount({invoke}){return {onInput:invoke.bind(null,'setBeta')};},dispose(){disposals++;}};
  }};
  const instance=await openExperiment(definition,{host,inputs:{dt:1/240}});
  const controls=await instance.mount({});
  assert.equal((await controls.onInput(.2)).effective.beta,.2);
  assert.equal((await instance.invoke('setBeta',.3)).effective.beta,.3);
  assert.equal(reads,0,'commands must not implicitly read dense state');
  assert.deepEqual(await instance.read(),{beta:.3,dt:1/240});
  assert.equal(recording.finish().operations.length,2);
  await assert.rejects(instance.invoke('toString'),/Unknown operation/);
  await instance.dispose();await instance.dispose();assert.equal(disposals,1);
  await assert.rejects(instance.invoke('setBeta',.4),/disposed/);
});

test('hand operations preserve unavailable intervals, source timing and custom output', async () => {
  const samples=[{captureOffsetMs:10,available:true},{captureOffsetMs:20,available:false,reason:'missing'}];
  let cursor=0;
  const instance=await openExperiment({id:'hand',title:'Recorded hand',create(){return {
    read:()=>samples[cursor],operations:{seek(index){cursor=index;return samples[index];}},
  };}},{host:{}});
  assert.deepEqual(await instance.invoke('seek',1),samples[1]);
  assert.deepEqual(await instance.read(),samples[1]);
  assert.equal(await instance.mount({}),null);
});

test('duplicate identity, import errors and invalid factories fail with source context', async () => {
  const definition={id:'same',title:'Same',create(){}};
  await assert.rejects(loadExperimentContributions(['/one','/two'],{loadModule:async()=>({default:definition})}),/Duplicate.*same.*one.*two/);
  await assert.rejects(loadExperimentContributions(['/broken'],{loadModule:async()=>{throw Error('syntax');}}),/broken.*syntax/);
  await assert.rejects(openExperiment({id:'missing',title:'Missing',create:()=>({operations:{}})},{host:{}}),/read/);
  await assert.rejects(openExperiment({id:'bad',title:'Bad',create:()=>({read(){},operations:{start:3}})},{host:{}}),/start/);
});
