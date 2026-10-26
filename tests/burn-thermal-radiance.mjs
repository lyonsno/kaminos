// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import {surfaceThermalRadiance} from '../burn-thermal-radiance.mjs';
import {thermalRadianceRGB} from '../volume-emissive-transport.mjs';
import {LIVE_LOG_HEAT_TO_FLUID_HEAT,stepLiveLogThermal} from '../live-log-heat-core.mjs';
import {linearLuminance} from '../volume-physical-color.mjs';
test('surface incandescence uses the volume Planck spectrum and radiant power',()=>{
 assert.deepEqual(surfaceThermalRadiance(0),[0,0,0]);
 for(const kelvin of [900,1200,1600,1900,2600,4000]){
  const actual=surfaceThermalRadiance((kelvin-300)/1600),expected=thermalRadianceRGB(kelvin);
  for(let i=0;i<3;i++)assert.ok(Math.abs(actual[i]-expected[i])<Math.max(1e-6,Math.abs(expected[i])*2e-7),`${kelvin}K channel ${i}`);
 }
 assert.ok(linearLuminance(surfaceThermalRadiance(2))>linearLuminance(surfaceThermalRadiance(1))*10,'heat above one must preserve its radiant power');
 assert.ok(linearLuminance(surfaceThermalRadiance(.3))<.001,'warm material must not acquire a flame-strength emission floor');
});
test('thermal calibration rejects invalid input and preserves actual heat range',()=>{
 for(const heat of [-1,NaN,Infinity])assert.throws(()=>surfaceThermalRadiance(heat),/heat/);
 for(const scale of [0,NaN,Infinity,7000])assert.throws(()=>surfaceThermalRadiance(1,scale),/Kelvin/);
 assert.ok(linearLuminance(surfaceThermalRadiance(1,1200))<linearLuminance(surfaceThermalRadiance(1,1600)));
});

test('material heat conversion is the existing passive-equilibrium unit change',()=>{
 let state=[0,0,0,0,0,1,0,0];
 for(let i=0;i<12000;i++)state=stepLiveLogThermal(state,1,.01);
 assert.ok(Math.abs(state[0]*LIVE_LOG_HEAT_TO_FLUID_HEAT-1)<1e-10);
 assert.ok(state[0]>1,'the resident material state retains its original unbounded heat units');
 const kelvin=300+state[0]*LIVE_LOG_HEAT_TO_FLUID_HEAT*1600;
 assert.ok(Math.abs(kelvin-1900)<1e-6,'an equilibrated body must share the exposing fluid calibration');
});
