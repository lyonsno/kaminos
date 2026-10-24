// kaminos-test: node
import assert from 'node:assert/strict';
import {Raycaster,Vector3} from '../lib/three.core.js';
import definition from '../experiments/surface-lighting-work.experiment.mjs';
const roots=[], beforeGI={mode:'off',temporal:true},beforeView={position:[4,5,6],target:[0,0,0],fov:50};
let gi=beforeGI,view=beforeView,disposed=false;
const environment={value:'0.75',dispatchEvent(){}};
const session={readView:()=>view,setView:v=>view=v,attach:async root=>roots.push(root),onFrame:()=>()=>{},dispose(){disposed=true;}};
const host={scene:{open:async()=>session,select(){}},rendering:{readGI:()=>gi,gi:v=>gi=v},controls:{document:{defaultView:{Event},getElementById:()=>environment}}};
const instance=await definition.create({host,inputs:{fixture:'bounce-corridor'},record(){}});
assert.equal(roots.length,1,'corridor fixture must attach its controlled geometry');
const root=roots[0];root.updateMatrixWorld(true);
const meshes=root.children.filter(o=>o.isMesh),emitter=meshes.find(o=>o.name==='Warm emitting panel');
assert.ok(emitter,'corridor has a named emitter');
const solids=meshes.filter(o=>o!==emitter);
function blocked(a,b){a=[a[0]*.5,a[1],a[2]];b=[b[0]*.5,b[1],b[2]];const delta=new Vector3().subVectors(new Vector3(...b),new Vector3(...a));return new Raycaster(new Vector3(...a),delta.clone().normalize(),1e-4,delta.length()-1e-4).intersectObjects(solids,false).length>0;}
for(const y of [.25,.8,1.35])for(const z of [-.55,0,.55])
 for(const x of [.5,1,1.5])for(const rz of [2.5,3,3.5])
  assert.ok(blocked([-3.85,y,z],[x,.076,rz]),'sheltered floor cannot see the emitter');
assert.equal(blocked([-3.85,.8,0],[1.899,.8,0]),false,'first wall sees the source');
assert.equal(blocked([1.899,.8,0],[1,.076,3]),false,'sheltered floor sees the first-lit wall');
assert.equal(environment.value,'0');assert.equal(gi.bounceFeedback,false);assert.equal(gi.temporal,true);
await instance.dispose();assert.equal(environment.value,'0.75');assert.deepEqual(gi,beforeGI);assert.deepEqual(view,beforeView);assert.equal(disposed,true);
console.log('Corridor has an occluded source-to-receiver path and an open two-leg bounce path; closing restores lighting/view.');
