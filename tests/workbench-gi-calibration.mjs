// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {calibrateSceneGISettingsForBounds,resolveSceneGIControlState} from '../scene-gi-settings.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function functionSource(name){const a=html.indexOf('function '+name+'('),b=html.indexOf('\n}',a);assert.ok(a>=0&&b>a,'production '+name+' must exist');return html.slice(a,b+2);}
for(const manual of [false,true])test('owned Workbench attachment '+(manual?'preserves explicit scale':'calibrates automatic scene scale'),()=>{
 let lightingSyncs=0;
 const c={arrivalLightingState:{bounds:null},extractObjectMaterialSamples:()=>[],inspectArrivalMaterialProfile:samples=>samples,syncArrivalStudioLighting:()=>lightingSyncs++,THREE,resolveSceneGIControlState,calibrateSceneGISettingsForBounds,sceneGIManuallyConfigured:manual,sceneGIBounceManuallyConfigured:true,sceneGIAutoCalibrationState:null,sceneGISettings:resolveSceneGIControlState({radius:manual?3:20,thickness:manual ? .3 : 7}),updateSceneGI:null,camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3()},workingScene:{objects:[]},document:{getElementById:()=>({})}};
 c.camera.position.set(0,0,4);c.registerSceneObject=(object,metadata)=>{const row={object,id:'owned',type:'experiment',...metadata};c.workingScene.objects.push(row);return row;};
 vm.createContext(c);vm.runInContext(functionSource('autoCalibrateSceneGIFromScene')+'\n'+functionSource('setSceneGIControls')+'\n'+functionSource('refreshArrivalLightingFromWorkingScene')+'\n'+functionSource('registerWorkbenchSceneObject'),c);
 const root=new THREE.Mesh(new THREE.BoxGeometry(2,3,2)),row=c.registerWorkbenchSceneObject(root,{label:'Owned geometry'});
 assert.equal(c.workingScene.objects[0],row);
 assert.equal(lightingSyncs,1);
 assert.deepEqual(Array.from(c.arrivalLightingState.bounds.min),[-1,-1.5,-1]);
 assert.deepEqual(Array.from(c.arrivalLightingState.bounds.max),[1,1.5,1]);
 if(manual){assert.equal(c.sceneGISettings.radius,3);assert.equal(c.sceneGISettings.thickness,.3);assert.equal(c.sceneGIAutoCalibrationState,null);}
 else{assert.ok(c.sceneGIAutoCalibrationState);assert.ok(Number.isFinite(c.sceneGIAutoCalibrationState.radius));assert.notEqual(c.sceneGISettings.radius,20);assert.notEqual(c.sceneGISettings.thickness,7);}
});
