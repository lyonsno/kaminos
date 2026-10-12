import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {BURN_TABLE_STATES,BURN_TABLE_ASSET,checkedBurnControls} from '../burn-table-core.mjs';
function fixture(){
  const elements=new Map();
  function make(tag='div'){
    return {tag,value:'',hidden:false,style:{},children:[],setAttribute(){},remove(){},
      append(el){this.children.push(el);if(el.id)elements.set(el.id,el);if(el.tag==='option'&&this.children.length===1)this.value=el.value;},
      prepend(el){this.append(el);},set innerHTML(value){for(const m of value.matchAll(/id="([^"]+)"/g))elements.set(m[1],make());},
      getBoundingClientRect(){return {width:100,height:100};}};
  }
  for(const id of ['tab-assets','viewport'])elements.set(id,make());
  const document={createElement:make,getElementById:id=>elements.get(id)};
  let resolveLoad,loads=0,registry=[],frames=0,selections=0;
  const model=()=>({position:{set(){}},rotation:{},visible:true,traverse(){}});
  const source=fs.readFileSync(new URL('../burn-table-experiment.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
  const ctx={document,BURN_TABLE_STATES,BURN_TABLE_ASSET,checkedBurnControls,THREE:{},console,createBurnMaterial(){}};
  vm.createContext(ctx);vm.runInContext(source+'\nglobalThis.install=installBurnTable;',ctx);
  const experiment=ctx.install({document,ready:Promise.resolve(),renderer(){},load(){loads++;return new Promise(resolve=>resolveLoad=()=>{const object=model();registry.push({object,id:'loaded-'+loads});resolve(object);});},
    clone:model,register(object){registry.push({object,id:'clone-'+registry.length});},objects:()=>registry,
    frame(){frames++;},initialView(){},select(){selections++;},dirty(){},enterWorkbench(){}});
  return {experiment,elements,resolve:()=>resolveLoad(),clear:()=>{registry=[];},removeOne:()=>{registry.splice(2,1);},
    read:()=>({loads,registry,frames,selections})};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('abandoning a pending load never reveals, frames or selects the fixture',async()=>{
  const f=fixture();const pending=f.experiment.open();await settled();f.elements.get('burn-table-experiment').value='none';f.elements.get('burn-table-experiment').onchange();f.resolve();await pending;
  assert.equal(f.experiment.state().active,false);assert.equal(f.elements.get('burn-table-labels').hidden,true);
  assert.equal(f.read().frames,0);assert.equal(f.read().selections,0);assert.ok(f.read().registry.every(e=>!e.object.visible));
});
test('reopening after shared clear reconstructs live registered samples',async()=>{
  const f=fixture();let pending=f.experiment.open();await settled();f.resolve();await pending;f.clear();
  pending=f.experiment.open();await settled();assert.equal(f.read().loads,2);f.resolve();await pending;
  const state=f.experiment.state();assert.equal(state.status,'mounted');assert.equal(state.objects.length,4);assert.ok(state.objects.every(o=>o.id));assert.equal(f.read().registry.length,4);
});
test('reopening replaces only the removed sample and retains surviving IDs',async()=>{
  const f=fixture();let pending=f.experiment.open();await settled();f.resolve();await pending;
  const old=f.experiment.state().objects.map(o=>o.id);f.removeOne();pending=f.experiment.open();await settled();assert.equal(f.read().loads,2);f.resolve();await pending;
  assert.equal(f.read().registry.length,4);const ids=f.experiment.state().objects.map(o=>o.id);assert.equal(ids[0],old[0]);assert.equal(ids[1],old[1]);assert.equal(ids[3],old[3]);assert.notEqual(ids[2],old[2]);
});
