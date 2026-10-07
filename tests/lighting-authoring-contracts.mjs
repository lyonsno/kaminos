import assert from 'node:assert/strict';
import test from 'node:test';
import { FLAME_PROPERTY_GROUPS } from '../flame-authoring.mjs';
import { createSceneEdits } from '../scene-edit-session.mjs';
import { installSceneControlHistory } from '../scene-control-history.mjs';

test('camera grading is not a shared flame material property',()=>{
  const fields=FLAME_PROPERTY_GROUPS.flatMap(group=>group.fields.map(([id])=>id));
  for(const id of ['volume-physical-exposure','volume-physical-white','volume-physical-knee','volume-exposure']) assert.ok(!fields.includes(id),`${id} is still a flame property`);
});

test('lighting targets validate options and whole snapshots, and preserve one undo/cancel boundary',async()=>{
  const { createLightingControlTarget }=await import('../scene-lighting-authoring.mjs');
  class Control extends EventTarget {
    constructor(id,type,value){super();Object.assign(this,{id,type,value,min:'0',max:'20',tagName:'INPUT'});}
  }
  const gain=new Control('gain','number','10'), toggle=new Control('enabled','checkbox','');toggle.checked=true;
  const mode=new Control('mode','','combined');mode.tagName='SELECT';mode.options=[{value:'gtao'},{value:'combined'}];
  const target=createLightingControlTarget([gain,toggle,mode]);
  const edits=createSceneEdits({read:()=>null,write(){}});edits.register('@lighting',target);
  const history=installSceneControlHistory({controls:[gain,toggle,mode],edits,id:'@lighting'});
  gain.dispatchEvent(new Event('focusin'));gain.value='5';gain.dispatchEvent(new Event('change'));
  assert.equal(edits.state().undoCount,1);edits.undo();assert.equal(gain.value,'10');edits.redo();assert.equal(gain.value,'5');
  gain.dispatchEvent(new Event('focusin'));gain.value='7';gain.dispatchEvent(new Event('pointercancel'));assert.equal(gain.value,'5');
  assert.throws(()=>target.check({...target.read(),gain:NaN}),/gain/);
  assert.throws(()=>target.check({...target.read(),mode:'unknown'}),/mode/);
  assert.throws(()=>target.check({...target.read(),enabled:1}),/enabled/);
  assert.throws(()=>target.check({gain:3}),/snapshot/);
  const before=target.read();assert.throws(()=>target.write({...before,gain:Infinity}),/gain/);assert.deepEqual(target.read(),before);
  history.dispose();
});
