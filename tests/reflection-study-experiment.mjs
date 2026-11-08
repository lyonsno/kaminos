// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,PerspectiveCamera,Vector3,Box3} from '../lib/three.core.js';
import definition from '../experiments/reflection-study.experiment.mjs';
import {createWorkbenchSceneHost} from '../workbench-scene-host.mjs';

test('reflection study registers independently editable meshes at actual floor contact',async()=>{
 const scene=new Scene(),camera=new PerspectiveCamera(),rows=new Map();let settings={enabled:false};
 const host=createWorkbenchSceneHost({scene,camera,controls:{target:new Vector3(),update(){}},
  loadAsset(){throw Error('No external asset');},registerObject(root,metadata){const row={id:root.uuid,root,...metadata};rows.set(root,row);return row;},
  findObject:root=>rows.get(root),removeObject({root}){root.removeFromParent();rows.delete(root);},redraw(){},onFrame(){throw Error('No private animation');},
 });
 const instance=await definition.create({host:{scene:host,rendering:{readReflections:()=>({...settings,settings}),reflections:value=>{settings={...settings,...value};}}},inputs:{},record(){},updateInputs(){}});
 try{
  assert.equal(rows.size,4,'floor, two blocks and sphere must each have a native registration');
  const byName=new Map([...rows.values()].map(row=>[row.root.name,row]));
  const floor=byName.get('Reflective ground').root,warm=byName.get('Warm reflected block').root,cool=byName.get('Cool reflected block').root;
  const bounds=object=>new Box3().setFromObject(object,true);
  assert.ok(Math.abs(bounds(warm).min.y-bounds(floor).max.y)<1e-6,'block begins at floor height');
  const before=cool.position.clone();warm.position.y+=.25;warm.updateMatrixWorld(true);
  assert.ok(Math.abs(bounds(warm).min.y-bounds(floor).max.y-.25)<1e-6);
  assert.deepEqual(cool.position,before,'lifting one registration leaves its sibling alone');
  assert.equal(instance.read().objects.length,4);
  assert.deepEqual(new Set(instance.read().objects.map(x=>x.id)),new Set([...rows.values()].map(x=>x.id)));
  instance.operations.setRoughness(.4);assert.equal(floor.material.roughness,.4);
 }finally{await instance.dispose();}
 assert.equal(rows.size,0);assert.equal(scene.children.length,0);assert.equal(settings.enabled,false);
});
