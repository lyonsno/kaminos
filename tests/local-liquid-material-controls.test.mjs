import assert from 'node:assert/strict';
import {normalizeLocalLiquidSetup,LOCAL_LIQUID_SCHEMA} from '../local-liquid-setup.mjs';
const materialControls={particleRepulsionStrength:.25,capillaryStrength:.4,freeFlightViscosityBoost:.1};
const scene={schema:LOCAL_LIQUID_SCHEMA,support:'retained_analytical_basin',particleCount:49152,densityIterations:2,materialControls};
assert.deepEqual(normalizeLocalLiquidSetup(scene).materialControls,materialControls,'saved material controls must not be discarded');
assert.deepEqual(normalizeLocalLiquidSetup(JSON.parse(JSON.stringify(scene))),scene);
for(const patch of [{particleRepulsionStrength:-1},{capillaryStrength:3},{freeFlightViscosityBoost:.5}])assert.throws(()=>normalizeLocalLiquidSetup({...scene,materialControls:{...materialControls,...patch}}));
const {materialControls:omitted,...legacy}=scene;assert.deepEqual(normalizeLocalLiquidSetup(legacy),legacy);
console.log('Authored water material settings round-trip; invalid values reject and old scenes remain compatible');

for(const materialControls of [null,true,[],"bad"])assert.throws(()=>normalizeLocalLiquidSetup({...scene,materialControls}),/material controls.*object/i);
