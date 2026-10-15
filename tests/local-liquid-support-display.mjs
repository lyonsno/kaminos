// kaminos-test: node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultLocalLiquidSetup, normalizeLocalLiquidSetup, localLiquidInletPacket } from '../local-liquid-setup.mjs';
import { createSceneEdits } from '../scene-edit-session.mjs';

test('new water fields hide demonstration support; saved legacy fields retain it', () => {
  assert.equal(defaultLocalLiquidSetup().showSupportGeometry, false);
  const old = { ...defaultLocalLiquidSetup() }; delete old.showSupportGeometry;
  assert.equal(normalizeLocalLiquidSetup(old).showSupportGeometry, true);
  for (const showSupportGeometry of [true, false]) {
    const setup = normalizeLocalLiquidSetup({ ...old, showSupportGeometry });
    assert.equal(normalizeLocalLiquidSetup(JSON.parse(JSON.stringify(setup))).showSupportGeometry, showSupportGeometry);
    assert.equal(setup.support, 'retained_analytical_basin');
  }
  for (const showSupportGeometry of ['false', 0, null]) {
    assert.throws(() => normalizeLocalLiquidSetup({ ...old, showSupportGeometry }), /Boolean/);
  }
});

test('support visibility changes no inlet publication or source epoch', () => {
  const source = readFileSync(new URL('../local-liquid-host.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('    setSetup(nextSetup) {');
  const end = source.indexOf('    setPaused(', start);
  const method = source.slice(start, end).trim().replace(/^setSetup/, 'function').replace(/,$/, '');
  let authored = defaultLocalLiquidSetup(), sourceGeneration = 7, publications = 0;
  let authoredEmitters = [], group = { visible: false };
  let publishedEmitterKey = JSON.stringify(localLiquidInletPacket(authored, []).emitters);
  const solver = { setLiveInletPacket() { publications++; } };
  const setSetup = eval('(' + method + ')');
  setSetup({ ...authored, showSupportGeometry: true });
  assert.equal(group.visible, true);
  assert.equal(authored.showSupportGeometry, true);
  assert.equal(publications, 0);
  assert.equal(sourceGeneration, 7);
  setSetup({ ...authored, showSupportGeometry: false });
  assert.equal(group.visible, false);
  assert.equal(publications, 0);
});

test('the actual frontend support control shares reversible scene history', () => {
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const a=source.indexOf("  scenePlacementTools.edits.register('@local-liquid-support-display',{");
  const b=source.indexOf('  scenePlacementTools.addHistoryScope',a);
  const c=source.indexOf('window.kaminosSetLocalLiquidSupportVisible =');
  const d=source.indexOf("document.getElementById('local-liquid-support-visible').addEventListener",c);
  let localLiquidSetup=defaultLocalLiquidSetup();
  const localLiquidHost={setSetup(){}},refreshLocalLiquidPerformance=()=>{},assertSceneConstructionAvailable=()=>{};
  const window={_kaminosDirty:()=>{}},scenePlacementTools={edits:createSceneEdits({read:()=>null,write:()=>{}})};
  eval(source.slice(a,b)+source.slice(c,d));
  window.kaminosSetLocalLiquidSupportVisible(true);
  assert.equal(localLiquidSetup.showSupportGeometry,true);
  scenePlacementTools.edits.undo();assert.equal(localLiquidSetup.showSupportGeometry,false);
  scenePlacementTools.edits.redo();assert.equal(localLiquidSetup.showSupportGeometry,true);
});
