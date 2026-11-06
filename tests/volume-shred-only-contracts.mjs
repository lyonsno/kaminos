// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveAppearanceModel} from '../volume-core.js';
import {FLAME_PROPERTY_GROUPS} from '../flame-authoring.mjs';
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
assert.equal(resolveAppearanceModel().effective,'shred-only');
const fields=FLAME_PROPERTY_GROUPS.flatMap(g=>g.fields.map(f=>f[0]));
assert.ok(fields.includes('volume-interface-shred'));
for(const id of ['volume-microdetail','volume-fire-licks','volume-swirl-jostle','volume-fine-breakup-localization','volume-fire-scale']){
 assert.ok(!fields.includes(id));
 assert.ok(!schema.controls.some(c=>c.key===id));
 assert.ok(schema.retiredControls.some(c=>c.key===id));
}
assert.ok(!fields.includes('volume-appearance-model'),'there is no longer an alternate activity architecture');
