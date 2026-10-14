import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('api.dispose=()=>'),source.indexOf(' if(host){unsubscribeFrames='));
for(const phase of ['release','completion','destructor'])test(`actual borrowed teardown survives ${phase} rejection`,async()=>{
 const calls=[],resource=name=>({dispose(){calls.push(name);if(phase==='destructor'&&name==='support.geometry')throw Error('destructor rejected');}}),object=name=>({geometry:resource(name+'.geometry'),material:resource(name+'.material')});
 const controls={enabled:true},api={},context={api,chunkMotion:resource('chunk-motion'),closing:false,paused:false,lifetime:{abort(){calls.push('abort');}},unsubscribeFrames(){calls.push('unsubscribe');},frameRequest:null,gestureGeneration:0,pointerContact:null,pendingPick:false,gesture:null,disposal:null,
  pickTask:Promise.resolve(),settle:async()=>{},resident:{release:async()=>{if(phase==='release')throw Error('release rejected');},dispose(){calls.push('resident');}},device:{queue:{onSubmittedWorkDone:async()=>{if(phase==='completion')throw Error('completion rejected');}}},
  pieces:[{gpu:resource('piece.gpu'),mesh:{geometry:resource('piece.geometry')}}],residentContact:resource('contact'),ground:object('ground'),residentGrip:resource('grip'),residentSupport:resource('support-state'),surface:resource('surface'),support:object('support'),marker:object('marker'),arrow:object('arrow'),capMaterial:resource('cap'),assets:[],disposeStoneAssets(){calls.push('assets');},container:{remove(){calls.push('scene.remove');}},scene:{},controls,previousControlsEnabled:false,host:{},AggregateError};
 vm.runInNewContext(body,context);
 await assert.rejects(api.dispose(),/rejected|cleanup/i);
 for(const name of ['chunk-motion','piece.gpu','piece.geometry','contact','ground.geometry','ground.material','grip','support-state','resident','surface','support.geometry','support.material','marker.geometry','marker.material','arrow.geometry','arrow.material','cap','assets','scene.remove'])assert.ok(calls.includes(name),`${name} cleanup must run after ${phase} failure`);
 assert.equal(controls.enabled,false);
 assert.equal(api.disposalStatus().complete,phase!=='destructor');
 assert.ok(api.disposalStatus().errors.some(error=>error.message.includes('rejected')));
});
