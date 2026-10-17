// kaminos-test: node
import assert from 'node:assert/strict';
import * as outer from '../volume-outer-smoke.mjs';
import {REACTANT_MODEL, reactantMaterialSurvival} from '../volume-reactant-combustion.mjs';
import {resolveJoinedGhosts} from '../volume-core.js';
import {resolveJoinedExteriorGeometry} from '../volume-joined-exterior.mjs';

const config=outer.outerSmokeConfig({materialMode:'reactant-raw',donorMode:'joined-full'});
assert.equal(config.materialMode,'reactant-raw');
const effective={admitted:true,law:'reactant-v0',coolingTimeSteps:17,model:REACTANT_MODEL};
for(const dt of [.25,1,2]){
  const values=outer.outerMaterialUniformValues(config,effective,dt);
  const survival=reactantMaterialSurvival(effective,dt);
  assert.deepEqual(values,[survival.heat,survival.smoke,1,0],
    'exterior must use the fine effective cooling and retirement, ambient oxygen, and no heat-to-soot birth');
}
assert.throws(()=>outer.outerMaterialUniformValues(config,null,1),/admitted reactant/);
assert.throws(()=>outer.outerMaterialUniformValues(config,{...effective,coolingTimeSteps:NaN},1),/cooling/);
const authored=outer.outerSmokeConfig({materialMode:'authored-raw'});
assert.deepEqual(outer.outerMaterialUniformValues(authored,null,1),[.982,.990,0,1]);
const shader=outer.outerSmokeShader(config,32);
assert.ok(!shader.includes('m.x+micro.x*.5+m.w*.08'),'appearance carriers cannot create raw soot at restriction');
assert.ok(shader.includes('nearOxidizer'),'reactant donor must read actual fine oxygen');
assert.ok(shader.includes('params.materialLaw.z'),'ambient oxygen must fill exterior samples');
assert.ok(shader.includes('sampleChannel(end,6)'),'oxygen must advect, not reset to ambient each frame');
assert.ok(!shader.includes('+passiveHeatToSmokeRate(heat,p.y)'),'reactant exterior must not create soot from heat');
assert.ok(shader.includes('result.material.w=donorOxidizer(c)'),'restricted oxygen replaces covered coarse state');
const g=resolveJoinedExteriorGeometry({fineDims:[32,32,32],pitch:2/32,reactant:true});
assert.equal(g.config.materialMode,'reactant-raw');
assert.equal(resolveJoinedGhosts({geometry:g.ghosts,reactantOn:true}).bound,true);
assert.equal(resolveJoinedGhosts({geometry:{...g.ghosts,oxidizer:undefined},reactantOn:true}).bound,false,
  'old or unspecified ghost providers still refuse reactant');
globalThis.GPUTextureUsage={TEXTURE_BINDING:4};
const texture=()=>({width:32,height:64,depthOrArrayLayers:32,format:'rg32float',dimension:'3d',usage:4});
const unusableDevice={get limits(){throw Error('allocation reached before input validation');}};
const duplicate=texture();
for(const textures of [[duplicate,duplicate],[texture(),{...texture(),usage:0}],[texture(),{...texture(),dimension:'2d'}]]) {
  assert.throws(()=>outer.createOuterSmoke(unusableDevice,config,32,[],{reactantTextures:textures,reactantEffective:effective}),/oxidizer textures required/,
    'unusable or aliased sidecars must refuse before allocating exterior resources');
}
console.log('outer reactant material contract passed');
