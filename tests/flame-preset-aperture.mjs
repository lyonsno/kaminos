// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as aperture from '../flame-authoring.mjs';
import {volumeSettingsPresetControlValuesEqual,volumeSettingsPresetAppliedDifferences} from '../volume-settings-preset-contract.mjs';
import {flamePoseToDomain,immersedControlsForFlamePose} from '../scene-flame-emitter.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
// Exercise the actual authored consumer, with only DOM representation mocked.
const source=html.slice(html.indexOf('function flameSettingsState('),html.indexOf('// Every reason the flame settings'));
function load(radius,options={},space,scale=1){
 const preset={domControls:{'volume-emitter-source-law':{value:'immersed-source'},'volume-immersed-radius':{value:radius,rawValue:String(radius)},...Object.fromEntries(['centre-x','centre-y','centre-z','yaw','pitch'].map(x=>['volume-immersed-'+x,{value:0}]))},rendererControls:{},presentationControls:{}};
 if(space)preset.sourceRadiusSpace=space;
 const current=structuredClone(preset);current.domControls['volume-immersed-radius']={value:.2/scale,rawValue:String(.2/scale)};
 const context={structuredClone,readVolumeSettingsValues:()=>current,activeVolumeSettingsPresetReceipt:null,flameEmitterPose:{position:[0,0,0],rotation:[0,0,0],scale:[scale,scale,scale]},flameDomainTranslation:[0,0,0],flameDomainScale:1,
 flamePoseToDomain,immersedControlsForFlamePose,flamePresetRadius:aperture.flamePresetRadius,document:{getElementById:()=>({cloneNode:()=>({value:0})})}};
 vm.createContext(context);vm.runInContext(source+';this.run=flameSettingsState',context);return context.run(preset,{presetId:'legacy-test',label:'Original',preset},options);
}
test('explicit legacy recovery retains current aperture rather than clamping saved radius',()=>{
 const state=load(135.764753512356,{sourceSize:'current'});
 assert.equal(state.domControls['volume-immersed-radius'].value,.2);
});
test('ordinary apply still refuses an unrecoverable legacy aperture',()=>assert.throws(()=>load(135.764753512356),/radius/));
test('legacy recovery preserves the source receipt instead of aliasing it to applied controls',()=>{
 const original=135.764753512356,state=load(original,{sourceSize:'current'});
 assert.equal(state.domControls['volume-immersed-radius'].value,.2);
 assert.equal(state.source.preset.domControls['volume-immersed-radius'].value,original,'the original preset receipt must retain its saved aperture');
 assert.notStrictEqual(state.source.preset.domControls,state.domControls);
});
test('portable preset applies the same effective aperture to differently scaled emitters',()=>{
 for(const scale of [.001,.1,1,8]){
   const state=load(.3,{},'simulation-v1',scale);
   assert.ok(Math.abs(state.domControls['volume-immersed-radius'].value*scale-.3)<1e-12);
   assert.equal(state.sourcePose.scale[0],scale);
   assert.equal(state.source.preset.domControls['volume-immersed-radius'].value,.3,'the portable receipt must stay in simulation coordinates');
   const projected=aperture.flamePresetForLocalControls(state.source.preset,scale);
   assert.equal(projected.domControls['volume-immersed-radius'].value,state.domControls['volume-immersed-radius'].value);
 }
});
test('a recovered legacy aperture takes the raw scene snapshot path',async()=>{
 const state=load(135.764753512356,{sourceSize:'current'}),start=html.indexOf('const basin = activeVolumeSettingsPresetReceipt',html.indexOf('async function collectSceneComposition'));
 const choose=html.slice(start,html.indexOf('  assertUnchanged();',start));
 const calls=[],context={activeVolumeSettingsPresetReceipt:state.source,preset:state,
   volumeSettingsPresetControlValuesEqual,document:{getElementById:()=>({value:'Recovered'})},
   saveVolumeSettingsPreset:async request=>{calls.push(request);return {effective:{presetId:'raw-recovered-snapshot'}};}};
 const result=await vm.runInNewContext(`(async()=>{${choose};return basin;})()`,context);
 assert.equal(result.presetId,'raw-recovered-snapshot');
 assert.equal(calls.length,1);assert.equal(calls[0].sceneSnapshot,true);
});
test('legacy recovery keeps effective size at a tiny destination scale',()=>assert.equal(load(135.764,{sourceSize:'current'},undefined,.001).domControls['volume-immersed-radius'].value,200));
test('portable source comparison uses local coordinates and still detects aperture edits',()=>{
 const saved={domControls:{'volume-emitter-source-law':{value:'immersed-source'},'volume-immersed-radius':{value:.2,rawValue:'.2'}},rendererControls:{},presentationControls:{},sourceRadiusSpace:'simulation-v1'};
 const applied=structuredClone(saved);applied.domControls['volume-immersed-radius']={value:2,rawValue:'2'};
 const callback=html.slice(html.indexOf('readSource:()=>activeVolumeSettingsPresetReceipt'),html.indexOf('    readSourceRuntime:',html.indexOf('readSource:()=>activeVolumeSettingsPresetReceipt'))).trim().replace(/^readSource:/,'').replace(/,$/,'');
 const context={activeVolumeSettingsPresetReceipt:{preset:saved,label:'Test'},readVolumeSettingsValues:()=>applied,volumeSettingsPresetControlValuesEqual,flamePresetForLocalControls:aperture.flamePresetForLocalControls,flamePoseToDomain:()=>({scale:[.1,.1,.1]}),flameEmitterPose:{},flameDomainTranslation:[],flameDomainScale:1};
 assert.equal(vm.runInNewContext(`(${callback})()`,context).modified,false,'successful scaled apply must not report Modified');
 assert.equal(typeof aperture.flamePresetForLocalControls,'function','local comparison projection is missing');
 const expected=aperture.flamePresetForLocalControls(saved,.1);
 const live=structuredClone(expected);delete live.sourceRadiusSpace;
 assert.equal(live.domControls['volume-immersed-radius'].value,2);
 assert.ok(volumeSettingsPresetControlValuesEqual(live,expected));
 assert.deepEqual(volumeSettingsPresetAppliedDifferences(expected,live),[]);
 live.domControls['volume-immersed-radius']={value:3,rawValue:'3'};
 assert.equal(volumeSettingsPresetControlValuesEqual(live,expected),false);
 assert.equal(saved.domControls['volume-immersed-radius'].value,.2);
 const raw=structuredClone(saved);delete raw.sourceRadiusSpace;
 assert.deepEqual(aperture.flamePresetForLocalControls(raw,.1),raw);
});
test('portable preset records simulation-space aperture and updates its launch route',()=>{
 const original={route:'http://localhost/?volume_immersed_radius=135.764',domControls:{'volume-emitter-source-law':{value:'immersed-source'},'volume-immersed-radius':{value:135.764}}};
 assert.equal(typeof aperture.portableFlamePreset,'function','portable save conversion is missing');
 const saved=aperture.portableFlamePreset(original,.001);
 assert.equal(saved.sourceRadiusSpace,'simulation-v1');
 assert.ok(Math.abs(saved.domControls['volume-immersed-radius'].value-.135764)<1e-15);
 assert.equal(Number(new URL(saved.route).searchParams.get('volume_immersed_radius')),saved.domControls['volume-immersed-radius'].value);
 assert.equal(original.domControls['volume-immersed-radius'].value,135.764);
 assert.ok(Math.abs(aperture.flamePresetRadius(saved,.01)-13.5764)<1e-12);
 assert.equal(aperture.flamePresetRadius(original,.01),135.764);
});
