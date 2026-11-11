// kaminos-test: node
import assert from 'node:assert/strict';import * as T from '../lib/three.core.js';
import {checkedMechanism,frames} from '../experiments/link-workshop/model.mjs';
import {bodyLayout,constructBodies} from '../experiments/link-workshop/bodies.mjs';
import {scanInteractions,elaborationFixture,proposeElaboration} from '../experiments/link-workshop/elaboration.mjs';
import {elaborationGeometry} from '../experiments/link-workshop/elaboration-geometry.mjs';
const forest=checkedMechanism({schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},...[1,2,3,4].map(()=>({parent:0,length:1,angles:[0,0]})),{parent:null,point:[.5,-.5]},{parent:5,length:1,angles:[Math.PI/2,Math.PI/2],layer:.88}],pistons:[]});
function explicit(m){const layout=bodyLayout(m);return {...m,nodes:m.nodes.map((n,i)=>n.parent===null?n:{...n,layer:layout.layers[i]}),pistons:m.pistons.map((p,i)=>({...p,z:p.z??layout.pistonZ+i*.22}))};}
const verdict=m=>scanInteractions(m).encounters.map(e=>({a:e.a.id,b:e.b.id,status:e.status,distance:e.distance,fraction:e.fraction}));
assert.deepEqual(verdict(forest),verdict(explicit(forest)),'Implicit native sibling layers and their explicit equivalents must give the same encounters');
const m=elaborationFixture();m.pistons.forEach(p=>delete p.z);assert.deepEqual(verdict(m),verdict(explicit(m)));
const geometry=elaborationGeometry(m),layout=bodyLayout(m),built=constructBodies(m),loader=new T.ObjectLoader();
for(const [i,p]of m.pistons.entries())for(const end of ['a','b']){const n=m.nodes[p[end]],id=`${n.parent===null?'anchor':'link'}:${p[end]}`,g=loader.parse(geometry.bodies.find(b=>b.id===id).object),at=p[end+'Offset']??[n.parent===null?0:n.length,0],seat=g.children.find(o=>o.name==='Actuator seat'&&Math.abs(o.position.x-at[0])<1e-9&&Math.abs(o.position.y-at[1])<1e-9);const actual=seat.position.z+layout.layers[p[end]],expected=built.defs.find(d=>d.id===`piston:${i}:barrel`).pose(frames(m,0)).position[2];assert.ok(Math.abs(actual-expected)<1e-9,`Seat ${i}/${end} meets effective native cylinder depth`);}
const carrier=proposeElaboration(m,null,{kind:'carrier',piston:1}),after=bodyLayout(carrier.recipe),before=bodyLayout(m);assert.deepEqual(after.layers.slice(0,m.nodes.length),before.layers,'Adding a carrier retains original effective body depths');assert.equal(carrier.recipe.pistons[0].z,m.pistons[0].z??before.pistonZ,'Unchanged cylinder retains effective depth after added topology');assert.equal(carrier.recipe.nodes.at(-1).layer,explicit(m).pistons[1].z);
console.log('Implicit/explicit encounter parity, native support seating and topology depth retention');
