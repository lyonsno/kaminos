// kaminos-test: node
import assert from 'node:assert/strict';
import { searchCommands, commandSearchShortcut } from '../scene-command-search.mjs';
const commands = [{id:'frame',category:'View',label:'Frame Selected',aliases:['focus']},{id:'add',category:'Add',label:'Cube',aliases:['box primitive']},{id:'other',category:'Add',label:'Cube Camera',aliases:[]}];
assert.deepEqual(searchCommands(commands,'  ADD BOX ').map(x=>x.id),['add']);
assert.deepEqual(searchCommands(commands,'cube').map(x=>x.id),['add','other']);
assert.deepEqual(searchCommands(commands,'FOCUS').map(x=>x.id),['frame']);
assert.deepEqual(searchCommands(commands,'missing'),[]);
const many=Array.from({length:150},(_,i)=>({id:String(i),category:'Test',label:`Item ${i}`}));
assert.equal(searchCommands(many,'item').length,150,'all matching commands remain reachable');
const body={},canvas={closest:()=>null},viewport={ownerDocument:{body},contains:node=>node===canvas};
const key={key:' ',code:'Space',target:canvas};
const context={activeElement:body,viewport,hover:true};
assert.equal(commandSearchShortcut(key,context),true);
assert.equal(commandSearchShortcut(key,{...context,hover:false}),false);
assert.equal(commandSearchShortcut(key,{...context,hover:false,activeElement:canvas}),true);
for(const kind of ['input','textarea','select','button','a','summary','treeitem','separator','contenteditable']) {
 const target={closest:selector=>selector.includes(kind)?{}:null};
 assert.equal(commandSearchShortcut({...key,target},context),false,`${kind} retains Space`);
 assert.equal(commandSearchShortcut(key,{...context,activeElement:target}),false,`focused ${kind} retains Space`);
}
for(const flag of ['repeat','defaultPrevented','isComposing','ctrlKey','metaKey','altKey','shiftKey'])assert.equal(commandSearchShortcut({...key,[flag]:true},context),false,flag);
assert.equal(commandSearchShortcut({...key,key:'F3',code:'F3'},{...context,hover:false}),true);
assert.equal(commandSearchShortcut({...key,key:'F3',target:{closest:()=>({})}},context),false);
console.log('Command token/alias ranking, uncapped results, viewport scope and control ownership pass');
