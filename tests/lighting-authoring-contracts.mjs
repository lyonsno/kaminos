import assert from 'node:assert/strict';
import test from 'node:test';
import { FLAME_PROPERTY_GROUPS } from '../flame-authoring.mjs';
import { createSceneEdits } from '../scene-edit-session.mjs';
import { installSceneControlHistory } from '../scene-control-history.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('camera grading is not a shared flame material property',()=>{
  const fields=FLAME_PROPERTY_GROUPS.flatMap(group=>group.fields.map(([id])=>id));
  for(const id of ['volume-physical-exposure','volume-physical-white','volume-physical-knee','volume-exposure']) assert.ok(!fields.includes(id),`${id} is still a flame property`);
});

test('the actual direction Swap button adds one transport edit and Undo leaves the preceding gain intact',async()=>{
  const {createLightingControlTarget}=await import('../scene-lighting-authoring.mjs');
  class Control extends EventTarget {constructor(id,type,value){super();Object.assign(this,{id,type,value,tagName:'INPUT',min:'',max:''});}}
  const directions=new Control('rendering-angular-samples','','24');directions.tagName='SELECT';directions.options=['12','24','48'].map(value=>({value}));
  const gain=new Control('rendering-shared-gain','range','0'),swap=new Control('rendering-angular-swap','button','');
  const nodes=new Map([directions,gain,swap].map(node=>[node.id,node]));
  const edits=createSceneEdits({read:()=>null,write(){}}),target=createLightingControlTarget([directions,gain]);edits.register('@scene-transport',target);
  const sessions=[];let runtimeDirections=24;
  const window={__kaminosSceneRadiance:{setDirections(value){runtimeDirections=value;}},kaminosAuthoringParameters:{set:(id,patch)=>edits.apply(id,patch)}};
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('let previousAngularCount=null'),end=html.indexOf("document.getElementById('rendering-retain-comparisons')",start);
  assert.ok(start>=0&&end>start,'actual direction handler is missing');
  vm.runInNewContext(html.slice(start,end),{document:{getElementById:id=>nodes.get(id)},window,authoringControlSessions:sessions,refreshRenderingControls(){},setInfo(message){throw Error(message);}});
  sessions.push(installSceneControlHistory({...target,edits,id:'@scene-transport'}));
  directions.dispatchEvent(new Event('focusin'));directions.value='12';directions.dispatchEvent(new Event('change'));
  gain.dispatchEvent(new Event('focusin'));gain.value='1';gain.dispatchEvent(new Event('change'));
  assert.equal(edits.state().undoCount,2);swap.dispatchEvent(new Event('click'));
  assert.equal(runtimeDirections,24);assert.equal(edits.state().undoCount,3,'Swap must be its own edit');
  edits.undo();assert.equal(runtimeDirections,12);assert.equal(gain.value,'1');
  edits.redo();assert.equal(runtimeDirections,24);assert.equal(gain.value,'1');
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
