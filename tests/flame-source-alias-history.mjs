// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {FLAME_PROPERTY_GROUPS,flameEmissionControlApplies} from '../flame-authoring.mjs';
import {fireControlOwner} from '../scene-fire-domain.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {installSceneControlHistory} from '../scene-control-history.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const authoring=readFileSync(new URL('../flame-authoring.mjs',import.meta.url),'utf8');
const handler=authoring.slice(authoring.indexOf('      field.addEventListener(eventName,()=>{'),authoring.indexOf('      source.addEventListener(\'input\',syncField);'));
const start=html.indexOf("  for(const alias of document.querySelectorAll('#selected-flame-fields [data-authoring-alias]'))");
assert.ok(start>=0);
const registration=html.slice(start,html.indexOf("  for(const id of ['fire-light-gain-stops'",start));
class Control {
  listeners=new Map();
  constructor(){this.type='checkbox';this.tagName='INPUT';this.checked=true;this.dataset={};}
  addEventListener(type,listener){const list=this.listeners.get(type)||[];list.push(listener);this.listeners.set(type,list);}
  removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==listener));}
  dispatchEvent(event){for(const listener of this.listeners.get(event.type)||[])listener({type:event.type,currentTarget:this});}
}

test('source dephasing alias records a source-scoped gesture and Undo/Redo leave another source alone',()=>{
  const id='volume-fixed-source-dephase';
  const group=FLAME_PROPERTY_GROUPS.find(group=>group.fields.some(([key])=>key===id));
  assert.equal(fireControlOwner(id),'source');
  const source=new Control(),field=new Control();field.dataset.authoringAlias=id;
  const values={primary:true,other:true},edits=createSceneEdits({read:()=>null,write(){}});
  const sessions=[];
  const ctx={field,source,id,eventName:'change',Event,fireControlOwner,installSceneControlHistory,
    activeSceneObjectId:'other',edits,authoringControlSessions:sessions,
    document:{querySelectorAll(selector){
      assert.equal(selector,'#selected-flame-fields [data-authoring-alias]');
      return group.scope==='emitter'?[field]:[];
    }},
    ensureFlameSourceDataTarget(selected){
      const target=`@source:${selected}`;
      edits.register(target,{read:()=>({value:values[selected]}),write:state=>{values[selected]=state.value;field.checked=state.value;},check:state=>state});
      return target;
    },
    writeSourceControl(key,value){assert.equal(key,id);values.other=value;return true;},
    syncVisibility(){},syncField(){},onError:error=>assert.fail(error.message),setInfo:message=>assert.fail(message),
  };
  sceneContext(ctx);vm.runInContext(handler,ctx);vm.runInContext(registration,ctx);
  assert.equal(sessions.length,1,'emitter alias must receive a history adapter');
  field.dispatchEvent(new Event('focusin'));
  assert.equal(edits.state().active?.id,'@source:other');
  field.checked=false;field.dispatchEvent(new Event('change'));
  assert.equal(values.other,false);
  assert.equal(edits.state().undoCount,1,'actual source-alias registration must capture the gesture');
  assert.equal(edits.state().active,null);
  assert.equal(edits.undo(),true);assert.deepEqual(values,{primary:true,other:true});
  assert.equal(edits.redo(),true);assert.deepEqual(values,{primary:true,other:false});
  assert.equal(group.scope,'emitter','source setting stays accessible on its selected emitter');
  assert.equal(flameEmissionControlApplies(id,'inflow-boundary'),true);
  sessions.forEach(session=>session.dispose());
});
