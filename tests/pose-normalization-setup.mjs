// kaminos-test: node
import assert from 'node:assert/strict';
import {validateNormalizationSetup} from '../experiments/creature-motion/pose-normalization-setup.mjs';
const sha='a'.repeat(64),other='b'.repeat(64);
const setup={correction:'pose-and-rig-proportions',castLabel:'Clean cat',casts:[
 {slug:'original',case_sha256:sha,frame_sha256:sha,motion_sha256:sha},
 {slug:'corrected',case_sha256:other,frame_sha256:sha,motion_sha256:sha}]};
assert.equal(validateNormalizationSetup(setup),setup);
assert.throws(()=>validateNormalizationSetup({...setup,correction:'pose-only'}),/proportion/);
assert.throws(()=>validateNormalizationSetup({...setup,casts:[setup.casts[0],{...setup.casts[1],motion_sha256:other}]}),/same motion/);
assert.throws(()=>validateNormalizationSetup({...setup,casts:[setup.casts[0],{...setup.casts[1],case_sha256:sha}]}),/distinct/);
assert.throws(()=>validateNormalizationSetup({...setup,casts:[setup.casts[0]]}),/two/);
