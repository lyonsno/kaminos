// kaminos-test: node
import assert from 'node:assert/strict';
import {createGranularPreparation} from '../granular-preparation.mjs';
const seed=createGranularPreparation({count:2,grainDetail:0,width:.04});seed.start('pour',{seconds:.01});while(seed.read().phase)seed.advance(.01);const saved=seed.snapshot();seed.dispose();
const local=createGranularPreparation(null,saved,{activeIds:[1]});local.start('settle',{seconds:.025});local.advance(.025);
assert.deepEqual(local.snapshot().grains[0].position,saved.grains[0].position,'a frozen neighboring grain must remain fixed during a local solve');
assert.ok(local.snapshot().grains[1].position[1]<saved.grains[1].position[1]);local.dispose();
assert.throws(()=>createGranularPreparation(null,saved,{activeIds:[1,1]}),/active/i);
assert.throws(()=>createGranularPreparation(null,saved,{activeIds:[8]}),/active/i);
