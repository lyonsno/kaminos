// kaminos-test: node
// The edge census through the host's own single-input invoke, with a scene session
// stand-in, so operations behave as Noah's controls and agent calls reach them.
import assert from 'node:assert/strict';
import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial} from '../lib/three.core.js';
import {openExperiment} from '../workbench-experiments.mjs';
import definition from '../experiments/poly-edge-census.experiment.mjs';

function finAsset(){
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,1,1,0,0,1,0,.5,.5,1],3));
  geometry.setIndex([0,1,2,0,2,3,0,2,4]);
  const mesh=new Mesh(geometry,new MeshStandardMaterial()),root=new Group();mesh.name='fin';root.add(mesh);
  return {id:'mesh-fin',root,owned:true,clips:[],source:'/fin.glb'};
}
const views=[],records=[];let disposed=false,loaded=null;
const host={controls:{document:null},scene:{open:async()=>({
  loadAsset:async({url})=>{loaded=url;return finAsset();},
  readView:()=>({fov:50,position:[0,0,5],target:[0,0,0]}),setView:view=>{views.push(view);return view;},
  redraw:()=>{},dispose:async()=>{disposed=true;},
})}};
const experiment=await openExperiment(definition,{host,inputs:{url:'/fin.glb'},record:r=>records.push(r)});
assert.equal(loaded,'/fin.glb');
let state=await experiment.read();
assert.deepEqual(state.counts,{nonManifold:1,boundary:6,sharp:0,flipped:0,uvSeam:0});
assert.equal(state.sharpAngle,60,'default crease angle');
assert.equal(state.census.nonManifoldEdges,1);

state=await experiment.invoke('setVisible',{name:'boundary',on:false});
assert.equal(state.visible.boundary,false);
state=await experiment.invoke('setVisible',{name:'boundary',on:true});
assert.equal(state.visible.boundary,true,'showing a class through the host invoke actually shows it');
await assert.rejects(experiment.invoke('setVisible','boundary'),/Unknown edge class|true or false/,'a call shaped for two arguments fails instead of silently hiding');
await assert.rejects(experiment.invoke('setVisible',{name:'boundary'}),/true or false/);
await assert.rejects(experiment.invoke('setXray','yes'),/true or false/);
state=await experiment.invoke('setXray',true);
assert.equal(state.xray,true);
state=await experiment.invoke('setSharpAngle',30);
assert.equal(state.sharpAngle,30);
await assert.rejects(experiment.invoke('setSharpAngle',200),/between 0 and 180/);
state=await experiment.invoke('frame',{direction:'front'});
assert.deepEqual(views.at(-1).target,[.5,.5,.5],'framing aims at the asset centre');
assert.ok(records.some(r=>r.kind==='poly-edge-census.visible'&&r.effective.visible.boundary===true),'operations are recorded with their effective state');
await experiment.dispose();
assert.equal(disposed,true);
