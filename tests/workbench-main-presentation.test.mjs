// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function actual(name){const a=source.indexOf('function '+name+'(');assert.ok(a>=0,'Explicit restored-asset presentation operation is missing: '+name);const b=source.indexOf('\n}\n',a);assert.ok(b>a);return source.slice(a,b+2);}
function fixture(){
 const root=new THREE.Group(),other=new THREE.Group();root.position.set(.08,.015,-.06);root.rotation.set(.05,.15,-.02);root.scale.set(1.05,.9,1.1);
 const rows=[{id:'body',object:root,label:'Creature'},{id:'other',object:other,label:'Other'}];
 const fields=new Map();for(const group of ['position','rotation','scale'])for(const axis of ['x','y','z'])fields.set(group+'.'+axis,{value:group==='scale'?'1':'0'});
 const nodes=new Map(['transform-inspector','transform-inspector-empty','transform-inspector-fields','transform-inspector-name','transform-inspector-id'].map(id=>[id,{dataset:{},hidden:false}]));
 const document={activeElement:null,getElementById:id=>nodes.get(id),querySelector:q=>fields.get(q.match(/data-transform-field="(.+)"/)?.[1])};
 let selected=rows[0],refreshes=0,redraws=0;
 const c={document,sceneObjects:rows,flameDomainGuide:null,activeSceneObjectId:'body',activeSceneGroupId:null,activeSceneFieldId:null,FLAME_EMITTER_ID:'flame',FLAME_EMITTER_TYPE:'flame-emitter',flameEmitterInjectionSuspended:false,
  sceneSelection:{ids:['body'],activeId:'body'},selectionProxy:null,
  syncLevelingButton(){},setTransformInspectorFieldsDisabled(){},updateSplatCorrectionPanel(){},syncEditorHelperVisibility(){},syncSelectionInspector(){},selectedPlacementEntry:()=>selected,
  scenePlacementTools:{draw(){refreshes++;},edits:{state:()=>({undoCount:3,redoCount:1,active:null})}},window:{_kaminosDirty(){redraws++;}}};
 vm.createContext(c);vm.runInContext(['sceneObjectTransformState','degreesFromRadians','updateTransformInspector','refreshWorkbenchAssetPresentation'].map(actual).join('\n'),c);
 return {root,other,rows,fields,nodes,document,c,refresh:()=>c.refreshWorkbenchAssetPresentation({id:'body',root}),selectOther(){selected=rows[1];c.activeSceneObjectId='other';},counts:()=>({refreshes,redraws})};
}
test('explicit refresh projects actual restored pose without writing history or selection',()=>{
 const f=fixture(),before=f.c.scenePlacementTools.edits.state(),pose=f.root.matrix.clone();
 const result=f.refresh();assert.equal(result.id,'body');assert.equal(result.selectionMatched,true);
 for(const [group,values]of [['position',f.root.position.toArray()],['rotation',f.root.rotation.toArray().slice(0,3).map(x=>x*180/Math.PI)],['scale',f.root.scale.toArray()]])for(let i=0;i<3;i++)assert.ok(Math.abs(Number(f.fields.get(group+'.'+['x','y','z'][i]).value)-values[i])<1e-8);
 assert.deepEqual(f.c.scenePlacementTools.edits.state(),before);assert.equal(f.c.activeSceneObjectId,'body');assert.deepEqual(f.counts(),{refreshes:1,redraws:1});
 assert.deepEqual(f.root.position.toArray(),[.08,.015,-.06]);assert.equal(f.nodes.get('transform-inspector').dataset.selectedObjectId,'body');
});
test('unselected asset refresh leaves current inspector and selection alone',()=>{const f=fixture();f.selectOther();const result=f.refresh();assert.equal(result.selectionMatched,false);assert.equal(f.c.activeSceneObjectId,'other');assert.deepEqual(f.counts(),{refreshes:0,redraws:1});assert.equal(f.fields.get('position.x').value,'0');});
test('stale receipt cannot refresh replacement or unrelated presentation',()=>{const f=fixture();assert.throws(()=>f.c.refreshWorkbenchAssetPresentation({id:'body',root:f.other}),/current|registration/);f.rows.splice(0,1);assert.throws(f.refresh,/current|registration/);assert.deepEqual(f.counts(),{refreshes:0,redraws:0});});
test('ordinary focused-field editing stays intact during explicit refresh',()=>{const f=fixture(),field=f.fields.get('position.x');field.value='draft';f.document.activeElement=field;f.refresh();assert.equal(field.value,'draft');assert.equal(Number(f.fields.get('position.y').value),.015);});
