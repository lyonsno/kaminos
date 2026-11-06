// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';
import { FLAME_PROPERTY_GROUPS } from '../flame-authoring.mjs';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
const transfer = readFileSync(new URL('../volume-fine-grid.mjs', import.meta.url), 'utf8');

test('candidate preserves legacy physical transport and explicitly bypasses carrier tail arithmetic', () => {
  const step = balancedWgslBlock(source, 'fn cs(@builtin');
  assert.match(balancedWgslBlock(step, 'if (SHRED_ONLY)'), /thermalAdvection\(cell, advectVelocity, speed, localMaterial.y, thermalAdvectionRiseDirection\)/);
  assert.match(balancedWgslBlock(step, 'if (!macCormack && !commonGasTransport)'), /let localMaterial = readSlot\(cellI, 1u\);[\s\S]*thermalAdvection/);
  for (const marker of ['// Retired activity sponge.', '// Retired activity quenching.']) {
    const tail = step.slice(step.indexOf(marker));
    assert.ok(step.includes(marker));
    assert.match(balancedWgslBlock(tail, 'if (!SHRED_ONLY)'), /flameDetail = flameDetail \* stepRate/);
  }
});

test('split-grid restriction specializes away discarded activity reads', () => {
  assert.match(transfer, /override SHRED_ONLY:bool=false;/);
  for (const name of ['restrictGeneral', 'restrictScalars']) {
    const body = balancedWgslBlock(transfer, `fn ${name}(`);
    const only = balancedWgslBlock(body, 'if(SHRED_ONLY)');
    assert.match(only, /d.y\+=fine\[fi\*4u\+3u\]\.y/);
    assert.doesNotMatch(only, /fineFront|fi\*4u\+2u/);
  }
  assert.match(transfer, /SHRED_ONLY:shredOnly/);
});

test('one-field Shred is opt-in, persisted and reachable from Flow properties', () => {
  assert.ok(core.APPEARANCE_MODELS.includes('shred-only'), 'one-field Shred must be an actual selectable model');
  assert.ok(schema.controls.find(c => c.key === 'volume-appearance-model').allowedValues.includes('shred-only'));
  assert.ok(FLAME_PROPERTY_GROUPS.some(g => g.view === 'motion' && g.fields.some(([id]) => id === 'volume-appearance-model')));
  assert.equal(core.appearanceModelUniformValue('shred-only'), 0, 'the candidate retains authored slot layout, not compact ratios');
});

test('specialized transport avoids auxiliary flame and front transport', () => {
  assert.match(source, /override SHRED_ONLY: bool = false;/);
  const predictor = balancedWgslBlock(source, 'fn csTransportPredict(');
  const only = balancedWgslBlock(predictor, 'if (SHRED_ONLY)');
  assert.match(only, /sampleFluidSlotInflow\(backCell, 1u\)/);
  assert.match(only, /sampleFluidSlotInflow\(backCell, 3u\)\.y/);
  assert.doesNotMatch(only, /sampleFluidSlot\w*\([^;]*2u/);
  assert.match(only, /return;/);
  const step = balancedWgslBlock(source, 'fn cs(@builtin');
  const transport = balancedWgslBlock(step, 'if (SHRED_ONLY)');
  assert.doesNotMatch(transport, /fireLayerAdvection|transportedMicrodetailAdvection|sampleFrontFieldTransport/);
  assert.match(transport, /microLayer = vec4<f32>\(0\.0,.*\.y, 0\.0, 0\.0\)/);
});

test('one-field birth reads physical material and fresh burn, not old activity histories', () => {
  const body = balancedWgslBlock(source, 'fn shredPhysicalInterface(');
  assert.match(body, /reactant/);
  assert.doesNotMatch(body, /2u\)|3u\)|readFrontField|material\.w/);
  const step = balancedWgslBlock(source, 'fn cs(@builtin');
  const birth = balancedWgslBlock(step, 'if (SHRED_ONLY) {\n    // One activity memory.');
  assert.match(birth, /shredOperatorGain/);
  assert.match(birth, /interfaceEnergy/);
  assert.doesNotMatch(birth, /fireLick|materialDetail|microSmoke|oracleMaterialBirth|flameReactionMemory/);
  assert.match(birth, /textureStore\(burnRate/);
});

test('unsupported laws report fallback; defaults and old layouts are retained', () => {
  assert.equal(core.resolveAppearanceModel().effective, 'authored');
  assert.equal(core.resolveAppearanceModel('shred-only', {reactant:true,physics:true}).effective, 'shred-only');
  assert.deepEqual(core.resolveAppearanceModel('shred-only', {reactant:true,physics:true}).transportedSlots, [0,1,3]);
  assert.equal(core.resolveAppearanceModel('shred-only', {reactant:false,physics:true}).reason, 'shred-only-requires-the-reactant-law');
  assert.equal(core.resolveAppearanceModel('shred-only', {reactant:true,physics:false}).effective, 'authored');
  assert.equal(core.resolveAppearanceModel('compact-3', {reactant:true}).effective, 'compact-3');
});

test('combined, material-only and velocity-only dispatches seat the compile-time model', () => {
  assert.match(source, /function simulationPipeline\(entryPoint, constants = \{\}\)/);
  const factory = source.slice(source.indexOf('    const specialized ='), source.indexOf('\n  function encodeSim('));
  assert.match(factory, /SHRED_ONLY: state\.appearanceModel\?\.effective === 'shred-only'/);
  assert.match(source, /pass\.setPipeline\(simulationPipeline\('cs', velocityOwner \? \{MATERIAL_ONLY:true\} : \{\}\)\)/);
  assert.match(source, /predictor\.setPipeline\(simulationPipeline\('csTransportPredict', velocityOwner \? \{MATERIAL_ONLY:true\} : \{\}\)\)/);
  assert.match(source, /simulationPipeline\(entry,\{VELOCITY_ONLY:true,VELOCITY_UNIT_SCALE:1\/owner\.plan\.materialPerVelocity\}\)/);
});
