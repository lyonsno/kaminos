// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';

const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const body=readFileSync(new URL('../scene-burn-body.mjs',import.meta.url),'utf8');
const a=body.indexOf('    // Detached fragments remain'),b=body.indexOf('    structure=createSceneBurnStructure',a);
assert.ok(a>=0&&b>a);
const scene=new THREE.Scene(),root=new THREE.Group(),physical=new THREE.Mesh(),overlay=new THREE.Object3D();
root.add(physical,overlay);overlay.userData.kaminosEditorHelper=true;
vm.runInNewContext(body.slice(a,b),{debris:{root},scene});
const start=page.indexOf('  const suspendEditorDrawingForVantage='),end=page.indexOf('  // A pick map',start);
assert.ok(start>=0&&end>start);
const context=vm.createContext({scene,transformControls:null,workingScene:{objects:[]},FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'water-emitter',selectionCaptureSuspended:false,selectionFeedback:null,selectionBoxes:new Map(),updateSelectionFeedback(){},window:{}});
vm.runInContext(page.slice(start,end)+'\nglobalThis.release=suspendEditorDrawingForVantage();',context);
assert.equal(root.visible,true,'Clean capture cannot hide the physical debris/fracture parent');
assert.equal(physical.visible,true);assert.equal(overlay.visible,false,'Actual structural diagnostics remain editor-only');
context.release();assert.equal(overlay.visible,true);
