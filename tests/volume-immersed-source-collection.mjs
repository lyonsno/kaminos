// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../volume-core.js';
const field={resolution:32,emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',pressureIterations:8,immersedRadius:.2,immersedSpeed:.1,immersedFuel:.56,immersedTemperature:1.2};
const source=(id,x=0)=>({id,controls:{...field,immersedCentreX:x,immersedCentreY:-.5,immersedPitch:90}});
function prototype(){
 const stub=()=>new Proxy(function(){},{get(t,p){if(p===Symbol.toPrimitive)return()=>0;if(p==='then')return undefined;return t[p]??(t[p]=stub());},set(t,p,v){t[p]=v;return true;},apply(){return stub();},construct(){return stub();}});
 globalThis.document=stub();globalThis.window=stub();globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 return core.createKaminosVolumePrototype({THREE:stub(),viewport:stub(),camera:stub(),controls:stub(),getControls:()=>field,onStatus(){}});
}
test('actual API validates and copies complete snapshots atomically without resetting the field',()=>{
 const p=prototype();assert.equal(typeof p.setImmersedSources,'function','actual provider method must exist');
 const a=source('a'),b=source('b',.3),reset=p.debugState().fluidStateResetCount;
 const first=p.setImmersedSources([a,b]);assert.equal(first.count,2);a.controls.immersedFuel=.01;
 assert.equal(p.debugState().immersedSources.requested[0].controls.immersedFuel,.56);
 assert.throws(()=>p.setImmersedSources([b,b]),/duplicate/i);
 assert.equal(p.debugState().immersedSources.revision,first.revision);
 const bad=source('bad');bad.controls.immersedSpeed=NaN;
 assert.throws(()=>p.setImmersedSources([bad]),/finite/i);assert.equal(p.debugState().immersedSources.count,2);
 const empty=p.setImmersedSources([]);assert.equal(empty.count,0);assert.equal(empty.active,true);
 assert.equal(p.debugState().fluidStateResetCount,reset);p.dispose();
});
test('compiled singleton retains existing normalization and shared pressure authority',()=>{
 assert.equal(typeof core.compileImmersedSourceCollection,'function');
 const a=source('a');a.controls.pressureSolver='legacy';
 const result=core.compileImmersedSourceCollection([a],{controls:field,grid:32,gridHeight:64});
 const singleton=core.resolveImmersedSourceConfig({...field,...source('a').controls},{grid:32,gridHeight:64});
 assert.deepEqual(result.sources[0].config,singleton);
 assert.deepEqual(Array.from(result.data.slice(result.width*result.height*4,result.width*result.height*4+24)),Array.from(new Float32Array(core.immersedSourceUniformValues(singleton))));
});
test('canonical packing is invariant under source order and disabled entries supply zero',()=>{
 assert.equal(typeof core.compileImmersedSourceCollection,'function');
 const a=source('a'),b=source('b');b.controls.immersedSourceEnabled=false;
 const options={controls:field,grid:32,gridHeight:64};
 const one=core.compileImmersedSourceCollection([a,b],options),two=core.compileImmersedSourceCollection([b,a],options);
 assert.deepEqual(one.data,two.data);assert.equal(one.sources[1].config.effective.admitted,false);
 assert.equal(core.compileImmersedSourceCollection([],options).count,0);
});
test('pressure diagnostics name every source supply rather than projecting the old singleton',()=>{
 const compiled=core.compileImmersedSourceCollection([source('a'),source('b',.3)],{controls:field,grid:32,gridHeight:64});
 const receipt=core.pressureResidualMeasurement(null,null,{active:true,sources:compiled.sources});
 const expected=compiled.sources.reduce((sum,s)=>sum+s.config.effective.fluxEffectivePredicted,0);
 assert.equal(receipt.immersedSource.fluxEffectivePredicted,expected);assert.equal(receipt.immersedSource.count,2);assert.match(receipt.immersedSource.law,/sum/);
});
