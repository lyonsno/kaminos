// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as source from '../scene-fire-domain.mjs';
const d=(value,param)=>({value,...(param?{param}:{}),rawValue:String(value)});
const record=(id,x,fuel)=>({id,type:'flame-emitter',source:'kaminos:analytic-flame',transform:{position:[x,.5,0],rotation:[0,0,0],scale:[1,1,1]},emission:{domainId:'flame-field',settings:{'volume-immersed-fuel':d(fuel),'volume-immersed-radius':d(.1),'volume-emitter-shear-width':d(2,'volume_emitter_shear_width_cells'),'volume-emitter-source-law':d('immersed-source')}}});
test('per-object source descriptors become independent domain-space inputs without changing shared controls',()=>{
 assert.equal(typeof source.flameSourceInputs,'function');
 const shared={resolution:32,gridHeightRatio:2,pressureSolver:'converged-open-top',immersedFuel:.7,immersedRadius:.2},a=record('a',-.3,.2),b=record('b',.3,.9);
 const inputs=source.flameSourceInputs([a,b],{controls:shared,translation:[.1,0,0],scale:2});
 assert.equal(inputs.length,2);assert.deepEqual(inputs.map(o=>o.id),['a','b']);
 assert.equal(inputs[0].controls.immersedFuel,.2);assert.equal(inputs[1].controls.immersedFuel,.9);
 assert.equal(inputs[0].controls.immersedCentreX,-.2);assert.equal(inputs[1].controls.immersedCentreX,(.3-.1)/2);
 assert.equal(inputs[0].controls.immersedRadius,.05);assert.equal(inputs[0].controls.emitterShearWidthCells,2);
 assert.equal(inputs[0].controls.pressureSolver,'converged-open-top');assert.equal(shared.immersedRadius,.2);
});
test('outside and disabled sources stop supply independently, and the empty collection stays empty',()=>{
 assert.equal(typeof source.flameSourceInputs,'function');
 const a=record('a',9,.2),b={...record('b',0,.9),emissionEnabled:false},c=record('c',0,.6);
 const inputs=source.flameSourceInputs([a,b,c],{controls:{resolution:32,gridHeightRatio:2}});
 assert.deepEqual(inputs.map(o=>o.controls.immersedSourceEnabled),[false,false,true]);
 assert.deepEqual(source.flameSourceInputs([],{controls:{}}),[]);
});
