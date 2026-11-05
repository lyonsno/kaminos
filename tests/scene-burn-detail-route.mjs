// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {forwardCompositionHash} from '../scene-authoring.mjs';

for(const detail of ['0','1'])test('preset admission retains the explicit closed-detail comparison: '+detail,()=>{
  const url=new URL(forwardCompositionHash('http://localhost/?settings_preset=vsp-test',
    '#workspace=workbench&scene=burn.kaminos.json&burn_fracture_cutout=0&burn_fracture_detail='+detail));
  const route=new URLSearchParams(url.hash.slice(1));
  assert.equal(route.get('burn_fracture_detail'),detail,'Preset redirect must preserve the requested partition');
  assert.equal(route.get('burn_fracture_cutout'),'0');
  assert.equal(route.get('scene'),'burn.kaminos.json');
});
