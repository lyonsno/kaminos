// kaminos-test: node
import assert from 'node:assert/strict';
import {resolveAuthoredWaterSampling,normalizeAuthoredWaterSampling,describeAuthoredWaterDrop} from '../authored-water-drop.mjs';
import {defaultLocalLiquidSetup,normalizeLocalLiquidSetup} from '../local-liquid-setup.mjs';
import {authoredDropSetup} from '../authored-water-host.mjs';
const bounds={min:[-2,-1,-2],max:[2,3,2]};
const source=(id,width,x=0)=>({id,transform:{position:[x,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width,samplesPerUnit:20}}});
const rows=[source('A',.6,-.5),source('B',.637,.5)],settings={...defaultLocalLiquidSetup(),waterSampling:{spacing:.04,particleTarget:8000,container:bounds}};
assert.equal(normalizeAuthoredWaterSampling(settings.waterSampling).particleTarget,8000,'Saved rough target must survive normalization');
const volume=.6**3+.637**3,s=resolveAuthoredWaterSampling(rows,settings);assert.ok(Math.abs(s.spacing-Math.cbrt(volume/8000))<1e-12);
const setup=authoredDropSetup(rows,settings),expected=rows.reduce((n,r)=>n+describeAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,s).particleCount,0);assert.equal(setup.solver.particleCount,expected);assert.equal(setup.waterSampling.particleTarget,8000);
const copy=structuredClone(rows);copy.forEach(r=>r.localLiquidEmitter.drop.width*=.5);const smaller=resolveAuthoredWaterSampling(copy,settings);assert.ok(Math.abs(smaller.spacing/s.spacing-.5)<1e-12);assert.equal(smaller.particleTarget,8000);assert.equal(copy.reduce((n,r)=>n+describeAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,smaller).particleCount,0),expected,'Same budget follows volume instead of exploding with inverse spacing');
const doubled=[...rows,source('C',.6,0)];assert.ok(resolveAuthoredWaterSampling(doubled,settings).spacing>s.spacing);assert.equal(resolveAuthoredWaterSampling(doubled,settings).particleTarget,8000);
const legacy=resolveAuthoredWaterSampling(rows,{waterSampling:{spacing:.04,container:bounds}});assert.ok(Math.abs(legacy.spacing-.04)<1e-12);assert.ok(Math.abs(legacy.particleTarget-volume/.04**3)<1e-8,'Old spacing setup seeds its equivalent rough target');
const roundTrip=normalizeLocalLiquidSetup(JSON.parse(JSON.stringify({...settings,waterSampling:s})));assert.equal(roundTrip.waterSampling.particleTarget,8000);assert.equal(resolveAuthoredWaterSampling(rows,roundTrip).spacing,s.spacing);
const empty=resolveAuthoredWaterSampling([],settings);assert.equal(empty.particleTarget,8000);assert.equal(empty.spacing,.04,'Empty setup retains a finite cached spacing for the next source');
for(const particleTarget of [0,-1,NaN,Infinity])assert.throws(()=>normalizeAuthoredWaterSampling({...settings.waterSampling,particleTarget}),/target/i);
console.log('Rough shared target derives finite spacing, persists, migrates legacy resolution and follows volume without altering requested source size');
