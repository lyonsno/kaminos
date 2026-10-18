// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRetainedSetupControls} from '../retained-setup-controls.mjs';
import {createRetainedSetup} from '../retained-setup.mjs';
function element(tag){return {tag,children:[],append(...items){this.children.push(...items);},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}};}
test('invalid default proposal still exposes choices and can be corrected',async()=>{
 const body=element('body'),root=element('section'),document={body,createElement:element};
 const setup=createRetainedSetup({document:{fuel:1}});
 const prepare=()=>setup.prepare({observe:()=>({fuel:2}),project:({baseline,observed,choices,describeOnly})=>{
  const groups=[{id:'placement',label:'Placement',checked:true},{id:'emission',label:'Emission',checked:true}];
  if(describeOnly)return {groups};
  if(choices.placement??true)throw Error('Outside retained domain');
  return {groups,document:{...baseline,fuel:observed.fuel}};
 }});
 mountRetainedSetupControls({document,root,title:'Scene',...setup,remember(){},prepare,save(){},begin(){}});
 await root.children[0].children.find(x=>x.textContent==='Keep in Setup').onclick();
 const dialog=body.children.find(x=>x.tag==='dialog');assert.ok(dialog?.open,'Invalid defaults must open editable choices');
 const footer=dialog.children.find(x=>x.tag==='footer'),keep=footer.children[1];assert.equal(keep.disabled,true);
 const checkbox=dialog.children.find(x=>x.tag==='label').children[0];checkbox.checked=false;checkbox.onchange();
 assert.equal(keep.disabled,false);keep.onclick();assert.equal(setup.read().document.fuel,2);
});
