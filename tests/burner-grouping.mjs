import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('window.createSceneGroupFromAllObjects = function'),html.indexOf('window.kaminosSceneObjectDebugState = function'));
test('grouping loose objects preserves burner assemblies and records one reversible change',()=>{
 const original={id:'burner',type:'burner-assembly',objectIds:['bed','flame']};
 let groups=[structuredClone(original)],history=[];
 const context={window:{},sceneObjects:[{id:'bed'},{id:'flame'},{id:'kiln'},{id:'@rim-light'}],RIM_LIGHT_ID:'@rim-light',
  get sceneGroups(){return groups;},makeSceneObjectId:()=> 'loose',setInfo(){},sceneGroupDisplayLabel:g=>g.label,setActiveSceneGroup(){},
  burnerEdit(change){history.push(structuredClone(groups));const next={groups:structuredClone(groups)};change(next);groups=next.groups;},
  createSceneGroupForObjects(ids,label){groups=groups.map(g=>({...g,objectIds:g.objectIds.filter(id=>!ids.includes(id))}));const group={id:'loose',label,objectIds:ids};groups.push(group);return group;}};
 vm.createContext(context);vm.runInContext(code,context);
 context.window.createSceneGroupFromAllObjects('Loose');
 assert.deepEqual(groups.find(g=>g.id==='burner'),original,'grouping must preserve the placement unit');
 assert.deepEqual(Array.from(groups.find(g=>g.id==='loose').objectIds),['kiln']);
 assert.equal(history.length,1);groups=history.pop();assert.deepEqual(groups,[original]);
});
