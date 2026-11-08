// kaminos-test: node
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const root=new URL('..',import.meta.url).pathname,schemaPath=root+'/volume-settings-preset-schema-v2.json';const schema=JSON.parse(await fs.readFile(schemaPath,'utf8'));
const {migrateRetiredVolumeSettingsPresetDocument,migrateRetiredVolumeCockpitLayoutDocument}=await import(pathToFileURL(root+'/volume-retired-control-migration.mjs'));
const legacyIds=['volume-world-smoke-intermediate','volume-intermediate-flow','volume-intermediate-material','volume-intermediate-pressure','volume-intermediate-iterations','volume-intermediate-extent'];
assert.deepEqual(schema.controls.filter(c=>legacyIds.includes(c.key)),[],'Cockpit inventory must agree with retired Middle controls');
const retired=schema.retiredControls.filter(c=>legacyIds.includes(c.key));assert.equal(retired.length,6,'Old saved fields need explicit retirement descriptors');
const controls=[...schema.controls,...retired];const route=new URL('http://kaminos.invalid/');const domControls={};
for(const c of controls){const value=c.key==='volume-world-smoke-iterations'?'12':c.key==='volume-world-smoke-intermediate'?'fields':c.additiveDefault??c.allowedValues?.[0]??'0';domControls[c.key]={id:c.key,param:c.param,tagName:c.tagName,type:c.type,value,rawValue:value};route.searchParams.set(c.param,value);}
const old={controlCount:controls.length,preset:{controlCount:controls.length,domControls,route:route.href}};
const migrated=migrateRetiredVolumeSettingsPresetDocument(old,schema);assert.deepEqual(migrated.removedControlIds.sort(),legacyIds.toSorted());assert.equal(migrated.document.preset.controlCount,schema.controlCount);assert.equal(migrated.document.preset.domControls['volume-world-smoke-iterations'].value,'12');
for(const c of retired)assert.equal(new URL(migrated.document.preset.route).searchParams.has(c.param),false);
const layout=migrateRetiredVolumeCockpitLayoutDocument({groups:[{id:'grids',controlIds:[...legacyIds,'volume-world-smoke-iterations']}]},schema.retiredControls);assert.deepEqual(layout.document.groups[0].controlIds,['volume-world-smoke-iterations']);
console.log('Middle retirement inventory and saved preset/layout migration preserve Fine/World controls');
