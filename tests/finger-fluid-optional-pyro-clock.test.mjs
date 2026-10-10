import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const frame=source.slice(source.indexOf('function drawFingerFluidBenchFrame('),source.indexOf('function kaminosFingerFluidBenchDebugState('));
const argument=frame.match(/advanceFingerFluidPyroCompositionSource\(([^;\n]+)\);/)?.[1];
const advance=new Function('volumePrototype','advanceFingerFluidPyroCompositionSource',`advanceFingerFluidPyroCompositionSource(${argument});`);
test('liquid bench tolerates absent Pyro and preserves real Pyro clock',()=>{
 let step='unset';assert.doesNotThrow(()=>advance(null,x=>{step=x;}));assert.equal(step,undefined);
 advance({debugState:()=>({simStepCount:243})},x=>{step=x;});assert.equal(step,243);
});
