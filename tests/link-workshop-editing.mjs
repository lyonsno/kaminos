// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import workshop from '../experiments/link-workshop.experiment.mjs';
import {createSceneEdits,transformPose} from '../scene-edit-session.mjs';
async function setup(){
 const scene=new T.Group(),edits=createSceneEdits({read(){throw Error('Missing target');},write(){throw Error('Missing target');}});let adapter;
 const session={async attach(root){scene.add(root);return {id:'workshop',root};},redraw(){},readView(){return {};},setView(){},onFrame(){return ()=>{};},async dispose(){scene.clear();}};
 const win={kaminosSceneEdits:edits,kaminosSelection:{set(){}}},host={scene:{async open(){return session;}},controls:{document:{defaultView:win},components:{register(id,a){adapter=a;return {changed(fn){edits.cancel();fn?.();},dispose(){}};}}}};
 const runtime=await workshop.create({host});const op=runtime.operations;op.append({parent:null,point:[0,0]});op.append({parent:0,point:[2,0]});
 return {runtime,op,edits,target:()=>adapter.target()};
}
{
 const {runtime,op,edits,target}=await setup(),h=target(),base=h.read();
 edits.apply(h.id,transformPose(base,{operation:'translate',axis:'y',amount:1}));const moved=runtime.read().recipe;
 edits.undo();edits.undo();edits.undo();assert.equal(runtime.read().recipe.nodes.length,0);
 edits.redo();edits.redo();assert.doesNotThrow(()=>edits.redo(),'Native history replays after empty construction');assert.deepEqual(runtime.read().recipe,moved);
 op.restore({schema:'kaminos.links.v1',nodes:[],pistons:[],period:3});edits.undo();assert.doesNotThrow(()=>edits.undo());assert.equal(runtime.read().recipe.nodes[1].length,2);
 await runtime.dispose();
}
{
 const {runtime,edits,target}=await setup(),h=target(),initial=h.read(),factor=initial.scale[0];
 const preview=value=>{const current=h.read();current.scale[0]=factor*value;edits.preview(current);};
 edits.begin(h.id);preview(2);preview(2.5);assert.equal(runtime.read().recipe.nodes[1].length,5,'Repeated numeric previews express final scale, not accumulated multipliers');edits.cancel();assert.equal(runtime.read().recipe.nodes[1].length,2);
 edits.begin(h.id);preview(2);preview(2.5);edits.commit();assert.equal(runtime.read().recipe.nodes[1].length,5);edits.undo();assert.equal(runtime.read().recipe.nodes[1].length,2);edits.redo();assert.equal(runtime.read().recipe.nodes[1].length,5);
 await runtime.dispose();
}
console.log('Native workshop history through empty state and numeric preview/commit/cancel/replay passed');
{
 const {runtime,op,edits,target}=await setup(),packet=op.exportBodies();packet.bodies=packet.bodies.filter(b=>b.id==='link:1');packet.bodies[0].object.materials[0].color=0xff00ff;await op.importBodies(packet);
 const color=()=>op.exportBodies().bodies.find(b=>b.id==='link:1').object.materials[0].color;
 const h=target();edits.begin(h.id);const change=h.read();change.scale[0]=4;edits.preview(change);edits.cancel();assert.equal(color(),0xff00ff,'Cancel restores returned appearance');assert.equal(runtime.read().recipe.nodes[1].length,2);
 op.move({joint:1,point:[3,0],mode:'build'});assert.equal(runtime.read().bodies.replacements,0);edits.undo();assert.equal(color(),0xff00ff,'Undo construction restores appearance');edits.redo();assert.equal(runtime.read().recipe.nodes[1].length,3);assert.equal(runtime.read().bodies.replacements,0);
 await runtime.dispose();
}
{
 const {createWorkbenchSceneHost}=await import('../workbench-scene-host.mjs');
 const {openExperiment}=await import('../workbench-experiments.mjs');
 const scene=new T.Scene(),rows=new Map(),edits=createSceneEdits({read(){throw Error('Missing target');},write(){throw Error('Missing target');}});let serial=0;
 const sceneHost=createWorkbenchSceneHost({scene,camera:new T.PerspectiveCamera(),controls:{target:new T.Vector3(),update(){}},loadAsset(){throw Error('Unused');},registerObject(root,metadata){const row={id:'object'+(++serial),root,...metadata};rows.set(row.id,row);return row;},findObject:root=>[...rows.values()].find(r=>r.root===root),removeObject:handle=>{handle.root.removeFromParent();rows.delete(handle.id);},redraw(){},onFrame(){return ()=>{};}});
 const host={scene:{...sceneHost,refreshPresentation(){}},controls:{document:{defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}},components:{register(){return {changed(fn){fn?.();},dispose(){}};}}}};
 const rt=await openExperiment(workshop,{host,record(){},inputs:{recipe:{schema:'kaminos.links.v1',nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[0,.5]}],pistons:[],period:3}}});
 const pending=rt.invoke('motionSpace');const outcome=pending.catch(e=>e);await rt.dispose();await outcome;
 assert.equal(rows.size,0,'Closing must release in-flight motion-space registrations');assert.equal(scene.children.length,0,'No orphan guide roots after closure');
}
{
 const {createSceneComponentEdit}=await import('../scene-component-edit.mjs');
 const {createSceneOwnerControls}=await import('../scene-owner-controls.mjs');
 class Element{constructor(){this.children=[];this.style={};this.className='';this.hidden=false;}append(...nodes){for(const n of nodes){if(typeof n==='string')continue;n.remove?.();this.children.push(n);n.parent=this;}}remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}setAttribute(k,v){this[k]=v;}}
 const scene=new T.Group(),edits=createSceneEdits({read(){throw Error('Missing target');},write(){throw Error('Missing target');}});
 let selected=null,asset,owners;
 const components=createSceneComponentEdit({selected:()=>selected,cancel:()=>edits.cancel(),refresh:()=>owners?.update()});
 const win={kaminosSceneEdits:edits,kaminosSelection:{set(ids){selected=ids[0];owners?.update();}}};
 const document={defaultView:win,createElement:()=>new Element()},viewport=new Element(),inspector=new Element();
 owners=createSceneOwnerControls({document,viewport,inspector,selected:()=>components.context?.()??(components.active()?components.target():selected===asset?.id?{id:selected,object:asset.root}:null)});
 const session={async attach(root){scene.add(root);asset={id:'workshop',root};return asset;},redraw(){},readView(){return {};},setView(){},onFrame(){return ()=>{};},async dispose(){scene.clear();}};
 const runtime=await workshop.create({host:{scene:{async open(){return session;}},controls:{document,components,mountObject:owners.mount,installNumberDrag:()=>({dispose(){}})}}});
 runtime.mount({root:new Element(),document,invoke:async(op,args)=>runtime.operations[op](args)});
 const notice=()=>viewport.children[0].children.find(e=>e['aria-label']==='Construction mode');
 const visible=()=>{assert.equal(inspector.children[0].hidden,false,'Empty editor retains owner properties');assert.equal(viewport.children[0].hidden,false,'Empty editor retains instruction container');assert.equal(notice().hidden,false);};
 runtime.operations.tool({value:'draw'});visible();assert.match(notice().textContent,/place a fixed anchor/);assert.equal(components.target(),null,'Owner context must not create a fake transform target');
 components.cancel();visible();assert.match(notice().textContent,/SELECT/);
 runtime.operations.tool({value:'draw'});visible();
 const camera=new T.PerspectiveCamera(38,1,.01,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 components.pick({clientX:50,clientY:50,shiftKey:false},{camera,canvas:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}});
 visible();assert.equal(runtime.read().recipe.nodes.length,1);assert.equal(components.target().type,'link-joint');
 selected='elsewhere';owners.update();assert.equal(inspector.children[0].hidden,true,'Changing owner hides old controls');assert.equal(components.active(),false);
 await runtime.dispose();
}
