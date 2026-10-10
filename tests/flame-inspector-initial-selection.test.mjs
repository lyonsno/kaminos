import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('function createFlameQuickFields() {');
const end=source.indexOf('\nfunction flameSettingsState(',start);
const createSource=source.slice(start,end);

function mount(activeSceneFieldId) {
  const elements=new Map([
    ['selected-flame-properties',{after(node){elements.set(node.id,node);}}],
    ['selected-flame-fields',{}],
    ['field-source-action',{}],
  ]);
  const document={createElement:()=>({hidden:false}),getElementById:id=>elements.get(id)};
  runInNewContext(createSource+'\ncreateFlameQuickFields();',{
    document,activeSceneFieldId,flameInspector:null,
    scenePlacementTools:{addHistoryScope(){}},createFlameInspector:()=>({}),
    activeVolumeSettingsPresetReceipt:null,
  });
  return elements.get('shared-flame-domain-properties');
}

test('new shared fire inspector follows current field selection at creation',()=>{
  for(const selected of [null,'water-field'])assert.equal(mount(selected).hidden,true,`fire controls must stay hidden for ${selected}`);
  assert.equal(mount('flame-field').hidden,false,'an explicitly selected fire field keeps its controls');
});
