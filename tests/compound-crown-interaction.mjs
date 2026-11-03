// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import definition from '../experiments/compound-crown.experiment.mjs';
import {Box3,Vector3} from '../lib/three.core.js';
async function fixture(){
 const nodes=[];let attached,currentView={position:[0,0,5],target:[0,0,0]},framed;
 const document={activeElement:null,defaultView:{location:{href:'http://localhost/?experiment=compound-crown'}},createElement(tag){const handlers=new Map(),node={tag,style:{},children:[],value:'',readOnly:true,setAttribute(){},append(...x){this.children.push(...x);},addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},emit(name){for(const fn of handlers.get(name)??[])fn({});}};nodes.push(node);return node;}};
 const session={attach:async root=>(attached={id:'crown',root}),onFrame:()=>()=>{},redraw(){},dispose:async()=>{},readView:()=>currentView,setView:view=>(currentView=view)};
 const host={scene:{open:async()=>session,select(){},refreshPresentation(){},frame(objects){framed=objects;const target=new Box3().setFromObject(objects[0]).getCenter(new Vector3());currentView={position:target.clone().add(new Vector3(7,5,8)).toArray(),target:target.toArray()};}},controls:{installNumberDrag:()=>({dispose(){}}),mountObject:()=>({dispose(){}})}};
 const app=await definition.create({host,inputs:{},record(){}});app.mount({root:document.createElement('div'),document,invoke:async(name,input)=>app.operations[name](input)});
 return{app,attached,nodes,get framed(){return framed;}};
}
test('framing follows the current moved and scaled apparatus',async()=>{
 const f=await fixture();try{f.attached.root.position.set(100,2,30);f.attached.root.scale.setScalar(2.5);f.attached.root.updateMatrixWorld(true);
 const expected=new Box3().setFromObject(f.attached.root).getCenter(new Vector3()).toArray();const actual=f.app.operations.frame();assert.deepEqual(actual.target,expected);assert.equal(f.framed[0],f.attached.root);
 }finally{await f.app.dispose();}
});
test('keyboard focus and activation reconstruct the latest native transform without a pointer event',async()=>{
 const f=await fixture();try{const link=f.nodes.find(n=>n.tag==='a');const transform=()=>JSON.parse(new URL(link.href).searchParams.get('experiment_inputs')).transform;
 f.attached.root.position.set(3,2,1);f.attached.root.rotation.set(.2,.3,.4);f.attached.root.scale.set(2,3,4);link.emit('focus');assert.deepEqual(transform(),f.app.read().transform);
 f.attached.root.position.set(-4,6,2);link.emit('click');assert.deepEqual(transform(),f.app.read().transform);
 }finally{await f.app.dispose();}
});
