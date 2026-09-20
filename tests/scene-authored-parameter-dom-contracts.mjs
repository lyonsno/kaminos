import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const lighting=['exposure-slider','env-intensity-slider','env-rotation-slider','env-blur-slider','fire-light-gain-stops'];
for(const id of lighting) {
  assert.match(index,new RegExp(`<label[^>]*\\bfor=["']${id}["'][^>]*>`),`${id} must expose an associated label that serves as its relative-drag grip`);
}
assert.match(index,/grip:row\.querySelector\('label'\)/,'the authored lighting descriptors must bind the associated label as the relative-drag grip');
const environmentSwitch=index.slice(index.indexOf('async function loadEnvironment'),index.indexOf('// Update button states',index.indexOf('async function loadEnvironment')));
assert.match(environmentSwitch,/sceneParameterTools\?\.discard\(Object\.values\(environmentRecipeFields\)\)/,'environment selection must discard only history for values it replaces');
assert.doesNotMatch(environmentSwitch,/scenePlacementTools\?\.clear\(\)/,'environment selection must not erase unrelated object and burner history');
console.log('authored lighting DOM grip contracts passed');
