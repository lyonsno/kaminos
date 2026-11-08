// kaminos-test: node
import assert from 'node:assert/strict';import {Group,Object3D,Vector3} from '../lib/three.core.js';import {createViewportPosePin} from '../viewport-pose-pin.mjs';
const root=new Group();root.position.set(1,2,3);root.rotation.y=.3;root.scale.setScalar(1.2);let unrelatedUpdates=0;
for(let i=0;i<100;i++){const child=new Object3D(),update=child.updateMatrixWorld;child.updateMatrixWorld=function(...args){unrelatedUpdates++;return update.apply(this,args);};root.add(child);}root.updateMatrixWorld(true);
const pin=createViewportPosePin({asset:{id:'test',root}});const local=[.2,.5,.3],face=[[0,.5,0],[0,.5,1],[1,.5,0]],world=p=>new Vector3(...p).applyMatrix4(root.matrixWorld).toArray();unrelatedUpdates=0;
try{pin.update({id:'pin',attached:true,worldPoint:world(local),worldFace:face.map(world)},{active:true});assert.equal(unrelatedUpdates,0,'A pin must not traverse every sibling in its specimen');assert.ok(Math.hypot(...pin.worldPoint().map((v,i)=>v-world([local[0],local[1]+.075,local[2]])[i]))<1e-8,'Source mount and eyelet remain correct under parent transforms');}finally{pin.dispose();}
