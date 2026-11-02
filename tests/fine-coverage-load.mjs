// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coverageSceneUrl,coverageSceneLoaded} from '../tools/automatic-coverage-load.mjs';

// Observed native saveSceneAs URL, consumer04 at 8dfcb52a7. The preset entry
// page rejects this exact route if its preset query parameter is removed.
const saved='/volume-settings-preset.html?preset=vsp-436968717e1c4652235f6c6fdecb97cd1c72ab63150870e5661ed7a132fec516#scene=Automatic-Fine-coverage--moving-fire.kaminos.json';
test('saved scene retains preset entry authority while selecting Workbench',()=>{
 const url=new URL(coverageSceneUrl(saved,'http://127.0.0.1:49732'));
 assert.equal(url.pathname,'/volume-settings-preset.html');
 assert.equal(url.searchParams.get('preset'),new URL(saved,url).searchParams.get('preset'));
 const hash=new URLSearchParams(url.hash.slice(1));
 assert.equal(hash.get('scene'),'Automatic-Fine-coverage--moving-fire.kaminos.json');
 assert.equal(hash.get('workspace'),'workbench');assert.equal(hash.get('experiment'),'material-hierarchy');
});
test('entry and runtime failure reject the load wait instead of waiting for a missing simulation',()=>{
 const oldWindow=globalThis.window,oldDocument=globalThis.document;
 try {
  globalThis.window={};globalThis.document={querySelector:()=>({textContent:'SETTINGS PRESET LOAD FAILED | settings preset id is required'})};
  assert.throws(coverageSceneLoaded,/settings preset id is required/);
  globalThis.document={querySelector:()=>null};
  globalThis.window={__kaminosVolumePrototype:{debugState:()=>({error:'Device lost',simStepCount:20})},kaminosWorkbenchExperiments:{state:()=>({id:'material-hierarchy'})}};
  assert.throws(coverageSceneLoaded,/Device lost/);
  window.__kaminosVolumePrototype.debugState=()=>({simStepCount:14});assert.equal(coverageSceneLoaded(),false);
  window.__kaminosVolumePrototype.debugState=()=>({simStepCount:15});assert.equal(coverageSceneLoaded(),true);
 } finally {globalThis.window=oldWindow;globalThis.document=oldDocument;}
});
