// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Object3D} from '../lib/three.core.js';
import {isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('function sceneObjectReloadabilityLabel('),end=source.indexOf('\nfunction selectedSceneObjectEntry(',start);
const context=vm.createContext({RIM_LIGHT_ID:'rim-light',CAMERA_TYPE:'camera',isReloadableSceneObjectRecord,
  sceneObjectTransformState:object=>({position:object.position.toArray(),rotation:object.rotation.toArray().slice(0,3),scale:object.scale.toArray()})});
vm.runInContext(source.slice(start,end),context);
test('a live authored camera has the same reloadability label as its saved record',()=>{
  const record={id:'vantage-test',type:'camera',source:'kaminos:camera',camera:{projection:'perspective',lens:24,sensorWidth:36,near:.05,far:1000},object:new Object3D()};
  assert.equal(context.sceneObjectReloadabilityLabel(record),'reloadable');
  assert.equal(context.sceneObjectReloadabilityLabel({...record,camera:{...record.camera,lens:0}}),'re-drop required');
});
