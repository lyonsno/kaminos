// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as aperture from '../flame-authoring.mjs';
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
 vm.createContext(context);vm.runInContext(source+';this.run=flameSettingsState',context);return context.run(preset,null,options);
}
test('explicit legacy recovery retains current aperture rather than clamping saved radius',()=>{
 const state=load(135.764753512356,{sourceSize:'current'});
 assert.equal(state.domControls['volume-immersed-radius'].value,.2);
});
test('ordinary apply still refuses an unrecoverable legacy aperture',()=>assert.throws(()=>load(135.764753512356),/radius/));
test('portable preset applies the same effective aperture to differently scaled emitters',()=>{
 for(const scale of [.001,.1,1,8]){
   const state=load(.3,{},'simulation-v1',scale);
   assert.ok(Math.abs(state.domControls['volume-immersed-radius'].value*scale-.3)<1e-12);
   assert.equal(state.sourcePose.scale[0],scale);
 }
});
test('legacy recovery keeps effective size at a tiny destination scale',()=>assert.equal(load(135.764,{sourceSize:'current'},undefined,.001).domControls['volume-immersed-radius'].value,200));
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
