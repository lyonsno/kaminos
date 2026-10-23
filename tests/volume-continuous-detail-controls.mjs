// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FLAME_PROPERTY_GROUPS} from '../flame-authoring.mjs';
import {fireControlOwner} from '../scene-fire-domain.mjs';
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const filter=index.match(/REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS\.filter\((field => [^\n]+?)\)\.map/)[1];
const forwarded=new Function(`return (${filter})`)();
for(const [id,key,value] of [['volume-render-detail','renderDetail',0],['volume-render-detail-scale','renderDetailScale',2],['volume-render-detail-fine','renderDetailFine',.35]]) {
  const descriptor=schema.controls.find(entry=>entry.key===id);
  assert.ok(descriptor,`${id} persists through existing basins`);
  assert.equal(descriptor.additiveDefault,value);
  assert.equal(fireControlOwner(id),'material','render displacement is material, not a source or simulation force');
  assert.equal(forwarded({key}),true,'actual authored snapshot reaches renderer');
  const groups=FLAME_PROPERTY_GROUPS.filter(group=>group.fields.some(([field])=>field===id));
  assert.equal(groups.length,1);assert.equal(groups[0].view,'look');
}
assert.equal(schema.controlCount,schema.controls.length);
console.log('continuous detail persists, belongs to Material and reaches the renderer');
