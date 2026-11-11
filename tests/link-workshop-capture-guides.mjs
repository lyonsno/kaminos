// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createMechanismView} from '../experiments/link-workshop/view.mjs';
const root=new T.Group(),view=createMechanismView(root);
const recipe={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,1]}],pistons:[]};
view.update(recipe,0,1,true);
const helpers=root.children.filter(x=>x.userData.kaminosEditorOnly);
assert.equal(helpers.length,1,'Joint markers and pose ghosts need a capture-excludable parent');
const guide=helpers[0];assert.equal(guide.children.length,4);
assert(view.markers().every(x=>x.parent===guide));
const body=root.children.find(x=>x!==guide);assert(body.visible);
// Native capture hides editor parents; live view updates must not re-enable them.
guide.visible=false;view.update(recipe,1,0,true);
assert.equal(guide.visible,false);assert.equal(body.visible,true);
assert(view.exportBodies().bodies.every(x=>!JSON.stringify(x.object).includes('kaminosEditorOnly')));
view.dispose();assert.equal(root.children.length,0);
console.log('capture excludes workshop guides while preserving body appearance');
