// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {sceneSmokeEnvironmentRecipe,createSceneSmokeEnvironment} from '../scene-smoke-environment.mjs';
import {readFireShadowSceneSettings,fireShadowSceneRoute} from '../fire-shadow-scene-settings.mjs';
const scene=new THREE.Scene(),map=new THREE.Texture();map.image={width:256,height:128};scene.environment=map;
assert.equal(sceneSmokeEnvironmentRecipe(scene,.4).blur,.4,'smoke environment bandwidth must be an effective projection input');
assert.equal(sceneSmokeEnvironmentRecipe(scene).blur,0,'older scenes retain the unblurred environment');
for(const blur of [-.1,1.01,NaN,Infinity])assert.throws(()=>sceneSmokeEnvironmentRecipe(scene,blur),/blur/);
const env=createSceneSmokeEnvironment({scene,renderer:{},device:{}});assert.equal(typeof env.setBlur,'function');assert.throws(()=>env.setBlur(-.1),/blur/);env.setBlur(.4);env.dispose();
const state={smokeEnvironmentBlur:.4,pointCount:4,pointSampling:'all',shadowResolution:128,blockerSamples:2,filterSamples:2,shadowSampling:'complementary',shadowSoftness:1,shadowImplementation:'shared',shadowGrain:'ordered',shadowWorldCellSize:.02};
assert.equal(readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute(state))).smokeEnvironmentBlur,.4);
console.log('PASS smoke-only environment prefilter recipe, validation and persistence');
