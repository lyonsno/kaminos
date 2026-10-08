import test from 'node:test';
import assert from 'node:assert/strict';
import * as semantics from '../scene-lighting-semantics.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('older distributed captures expose unsaved transport and camera-link state',()=>{
  assert.equal(typeof semantics.sceneLightingRestoreWarnings,'function','legacy lighting gaps must not look like complete restores');
  const legacy={composition:{route:{volume_light_field_distributed:'1'}},postprocessing:{sceneGI:{gain:10}}};
  assert.deepEqual(semantics.sceneLightingRestoreWarnings(legacy).map(w=>w.code),['transport-not-saved','camera-link-not-saved']);
});

test('recorded lighting/camera namespaces and ordinary mesh scenes have no missing-state warning',()=>{
  assert.equal(typeof semantics.sceneLightingRestoreWarnings,'function','warning resolver must be present');
  const modern={composition:{route:{volume_light_field_distributed:'1'}},postprocessing:{
    lighting:{'@scene-transport':{'rendering-shared-gain':0,'rendering-surface-gain':0}},sceneCamera:{exposureEV:0}}};
  assert.deepEqual(semantics.sceneLightingRestoreWarnings(modern),[]);
  assert.deepEqual(semantics.sceneLightingRestoreWarnings({postprocessing:{sceneGI:{gain:10}}}),[]);
});

test('actual restore notice exposes gaps and clears when the saved document is complete',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function showSceneLightingRestoreWarnings('),end=html.indexOf('let backdropMesh',start);
  const notice={textContent:'',hidden:true},window={};
  const context=vm.createContext({window,document:{getElementById:()=>notice},sceneLightingRestoreWarnings:semantics.sceneLightingRestoreWarnings});
  vm.runInContext(html.slice(start,end),context);
  context.showSceneLightingRestoreWarnings({composition:{route:{volume_light_field_distributed:'1'}}});
  assert.equal(notice.hidden,false);assert.match(notice.textContent,/did not store transported-light/);
  assert.equal(window.kaminosSceneLightingRestoreWarnings.length,2);
  context.showSceneLightingRestoreWarnings({composition:{route:{volume_light_field_distributed:'1'}},
    postprocessing:{lighting:{'@scene-transport':{}},sceneCamera:{exposureEV:0}}});
  assert.equal(notice.hidden,true);assert.equal(notice.textContent,'');
  assert.deepEqual(window.kaminosSceneLightingRestoreWarnings,[]);
});
