// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createRegistrationViewer,sourceParts} from '../registration-viewer.mjs';
import {mountRegistrationControls} from '../registration-controls.mjs';
const primitive={id:'box',type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'box',parameters:{width:2,height:2,depth:2}},transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}};
const parts=sourceParts({objects:[primitive],provenance:{analyticalCarrier:{parts:{a:['box'],b:['box']}}}});
const target=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial());const original=target.material;
const v=createRegistrationViewer({target,parts});
v.configure({alignment:{rotation:[0,0,0]}});await v.compute();
assert.equal(v.read().summary.overlap,12);
assert.equal(typeof v.claimPieces,'function','computed claims must expose independently movable preview pieces');
const pieces=v.claimPieces();
assert.equal(pieces.length,4,'each part plus contested and unclaimed surfaces');
assert.equal(pieces.find(p=>p.id==='a').triangles,12);
assert.equal(pieces.find(p=>p.id==='b').triangles,12,'overlap is not forced to one owner');
assert.equal(pieces.find(p=>p.id==='contested').triangles,12);
assert.equal(pieces.find(p=>p.id==='unclaimed').triangles,0);
const originalPositions=target.geometry.attributes.position.array.slice();
pieces[0].root.position.x+=10;
assert.deepEqual(target.geometry.attributes.position.array,originalPositions,'preview movement never edits target vertices');
assert.notDeepEqual(pieces[0].root.position.toArray(),pieces[1].root.position.toArray());
for(const p of pieces)p.dispose();
assert.equal(target.geometry.groups.length,6,'preview grouping does not mutate original groups');
for(const flip of [1,-1]){
 const mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({side:T.FrontSide}));mesh.geometry.computeTangents();mesh.scale.x=flip;
 const attributes=Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([k,a])=>[k,a.array.slice()]));
 const check=createRegistrationViewer({target:mesh,parts});check.configure({alignment:{rotation:[0,0,0]}});await check.compute();
 const rows=check.claimPieces(),surface=rows[0].root.children.find(n=>n.isMesh),g=surface.geometry,p=g.attributes.position,n=g.attributes.normal;
 assert.equal(surface.material.side,T.FrontSide);assert.equal(rows[0].triangles,12);
 for(let f=0;f<p.count;f+=3){const a=new T.Vector3().fromBufferAttribute(p,f),b=new T.Vector3().fromBufferAttribute(p,f+1),c=new T.Vector3().fromBufferAttribute(p,f+2);assert.ok(b.sub(a).cross(c.sub(a)).normalize().dot(new T.Vector3().fromBufferAttribute(n,f))>.999,'baked preview front face agrees with transformed normal');}
 const order=flip<0?[0,2,1]:[0,1,2];
 for(let f=0;f<12;f++)for(let vtx=0;vtx<3;vtx++){const sourceIndex=mesh.geometry.index.getX(f*3+order[vtx]),dest=f*3+vtx;assert.equal(g.attributes.uv.getX(dest),mesh.geometry.attributes.uv.getX(sourceIndex));assert.equal(g.attributes.uv.getY(dest),mesh.geometry.attributes.uv.getY(sourceIndex));assert.equal(g.attributes.tangent.getW(dest),mesh.geometry.attributes.tangent.getW(sourceIndex)*flip);}
 assert.deepEqual(g.groups,mesh.geometry.groups);
 for(const [k,array]of Object.entries(attributes))assert.deepEqual(mesh.geometry.attributes[k].array,array,'target attributes remain untouched');
 rows.forEach(r=>r.dispose());check.dispose();
}
v.configure({solo:'a',parts:{b:{visible:false}},targetOpacity:.2});
assert.equal(v.read().summary.overlap,12,'visibility must not alter membership');
assert.equal(original.opacity,1,'original material is untouched');
assert.equal(target.material.opacity,.2);
const before=v.read();assert.throws(()=>v.configure({target:false,alignment:{scale:0}}),/Scale/);assert.deepEqual(v.read(),before,'invalid patch is atomic');
v.configure({alignment:{position:[10,0,0]}});assert.equal(v.read().status,'not computed');await v.compute();assert.equal(v.read().summary.unclaimed,12);
target.position.x=1;v.refresh();assert.equal(v.read().status,'not computed','moving target invalidates claims');
assert.throws(()=>v.claimPieces(),/Compute current/,'stale claims cannot be exported as current pieces');
await v.compute();target.geometry.attributes.position.setX(0,20);target.geometry.attributes.position.needsUpdate=true;v.refresh();
assert.equal(v.read().status,'not computed','editing geometry invalidates claims');
await v.compute();const replacement=new T.BufferAttribute(target.geometry.attributes.position.array.slice(),3);replacement.version=target.geometry.attributes.position.version;target.geometry.setAttribute('position',replacement);v.refresh();
assert.equal(v.read().status,'not computed','replacing a position buffer invalidates claims');
assert.equal(v.diagnostic.visible,false);assert.equal(v.read().summary,null);
await v.compute();const replacementIndex=new T.BufferAttribute(target.geometry.index.array.slice(),1);replacementIndex.version=target.geometry.index.version;target.geometry.setIndex(replacementIndex);v.refresh();assert.equal(v.read().status,'not computed','replacing index buffer invalidates claims');
const pending=v.compute();v.dispose();await pending;assert.equal(target.material,original);assert.equal(target.visible,true);
assert.throws(()=>v.configure({target:false}),/disposed/);
const moved=createRegistrationViewer({target,parts});
moved.ghost.position.set(2,3,4);moved.ghost.rotation.y=.2;moved.ghost.scale.set(2,3,4);moved.refresh();
assert.deepEqual(moved.read().alignment.position,[2,3,4],'native gizmo movement becomes alignment state');
assert.deepEqual(moved.read().alignment.scale,[2,3,4],'native per-axis scale survives');
moved.configure({referenceOpacity:.7});assert.deepEqual(moved.ghost.position.toArray(),[2,3,4],'display edits never undo native placement');
assert.equal(moved.bounds.isLineSegments,true,'source bounds have visible geometry');
moved.ghost.scale.x=0;
await assert.rejects(moved.compute(),/nondegenerate source scale/,'collapsed native geometry cannot produce apparently valid claims');
moved.dispose();
// Minimal DOM adapter exercises publication into the actual control module;
// it is not a browser/layout or native-number-drag witness.
class Element{
 constructor(tag){this.tag=tag;this.style={};this.attrs={};this.children=[];this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this.attrs[k]=v;}
 removeAttribute(k){delete this.attrs[k];}
 addEventListener(){}
 set href(value){this.attrs.href=value;}
 get href(){return this.attrs.href;}
}
for(const missing of ['source','target']){
 let reason=null,panel;const nodes=[],published=[];
 const document={activeElement:null,createElement:tag=>{const node=new Element(tag);nodes.push(node);return node;}};
 const live=createRegistrationViewer({target:new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()),parts,
  unavailableReason:()=>reason,onChange:s=>{published.push(s.status);panel?.sync();}});
 panel=mountRegistrationControls({root:new Element('div'),document,read:()=>({...live.read(),joints:[]}),invoke:()=>{},retain:()=>reason?null:'http://retained.example',controls:{installNumberDrag:()=>({stop(){}})}});
 const pending=live.compute();reason=missing+' was removed';await pending;live.refresh();
 assert.equal(published.at(-1),live.read().status,'yield-time removal publishes its terminal state');
 assert.match(nodes.find(n=>n.attrs.role==='status').textContent,/unavailable/);
 assert.equal(nodes.find(n=>n.textContent==='Compute claims').disabled,false,'controls no longer report active computation');
 assert.equal(nodes.find(n=>n.tag==='a').href,undefined,'unavailable comparison removes stale retain link');
 assert.equal(live.diagnostic.visible,false);panel.dispose();live.dispose();
}
console.log('registration viewer: full overlapping claims, isolation, invalidation, cancellation and restoration pass');
