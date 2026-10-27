// kaminos-test: node
import assert from 'node:assert/strict';import {assertWholeObjectAtRest,assertGrabbedMaterialFractures} from '../tools/fracture-whole-response-contract.mjs';
const material={broken:0,step:4,hand:{index:0},bodies:[{},{},{},{}],bonds:[{id:'loaded',a:0,b:1,alive:true},{id:'elsewhere',a:2,b:3,alive:true}],events:[],config:{strength:10}},before={material},after={material:{...material,step:5,broken:1,events:[{id:'elsewhere',kind:'crack',step:5,handActive:true,reaction:20,stress:20}]}};
assert.throws(()=>assertGrabbedMaterialFractures({before,after}),/grabbed material load path/,'A fracture elsewhere must not masquerade as successful manipulation');
after.material.events[0].id='loaded';assert.deepEqual(assertGrabbedMaterialFractures({before,after}).loadedCracks,['loaded']);
after.material.events[0].handActive=false;assert.throws(()=>assertGrabbedMaterialFractures({before,after}),/grabbed material load path/);
const initial={material:{...material,hand:null}},unloaded={material:{...material,hand:null,step:24}};assertWholeObjectAtRest({initial,unloaded});unloaded.material.broken=1;assert.throws(()=>assertWholeObjectAtRest({initial,unloaded}),/without an applied hand/);unloaded.material.broken=0;initial.material.broken=1;assert.throws(()=>assertWholeObjectAtRest({initial,unloaded}),/construction/);
