// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneArrivalPresentation} from '../scene-arrival-presentation.mjs';
const material={opacity:.6,depthWrite:true,color:'red',copy(other){Object.assign(this,other);return this;},clone(){return {...this,dispose(){}};}};
const node={visible:true,material,traverse(fn){fn(this);}};
const p=createSceneArrivalPresentation();p.set([['stage',.5]]);
assert.throws(()=>p.withFrame([{id:'stage',object:node}],()=>{assert.equal(node.material.opacity,.3);assert.equal(node.material.depthWrite,true,'water depth must retain the mold');throw Error('draw failed');}),/draw failed/);
assert.equal(node.material,material);assert.equal(node.visible,true);
material.color='blue';p.withFrame([{id:'stage',object:node}],()=>assert.equal(node.material.color,'blue'));
p.set([['stage',0]]);p.withFrame([{id:'stage',object:node}],()=>assert.equal(node.visible,false));assert.equal(node.visible,true);
p.dispose();assert.equal(p.opacity('stage'),1);
