// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SceneTransformControls} from '../scene-transform-gizmo.mjs';
import {captureComposedCanvases} from '../scene-authoring.mjs';
import {composeViewport} from '../agent-vantage.mjs';
function fixture(){
 const draws=[],strokes=[],children=[],bounds={left:0,top:0,width:1000,height:800,right:1000,bottom:800};
 const context={drawImage:(...args)=>draws.push(args),setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){strokes.push(true);}};
 const element=tag=>({tagName:tag.toUpperCase(),style:{},width:1000,height:800,setAttribute(){},getBoundingClientRect:()=>bounds,getContext:()=>context,toDataURL:()=> 'data:image/png;base64,YQ==',closest:()=>null,remove(){children.splice(children.indexOf(this),1);}});
 const document={pointerLockElement:null,createElement:element,createElementNS:(_ns,tag)=>element(tag)};
 const parent={getBoundingClientRect:()=>bounds,append(node){children.push(node);node.parentElement=this;}};
 const host=Object.assign(new EventTarget(),element('canvas'),{id:'host',ownerDocument:document,parentElement:parent});
 const window={getComputedStyle:node=>({display:'block',visibility:'visible',opacity:'1',zIndex:'0',...node.style})};
 const viewport={querySelectorAll:()=>[host,...children.filter(node=>node.tagName==='CANVAS')]};
 const camera=new THREE.PerspectiveCamera(50,1.25,.01,100);camera.position.set(-4,3,6);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());scene.add(mesh);
 const gizmo=new SceneTransformControls(camera,host);scene.add(gizmo.getHelper());gizmo.attach(mesh);scene.updateMatrixWorld(true);
 return {draws,strokes,document,window,viewport,host,gizmo,scene,overlay:children[0]};
}
test('the actual visible transform overlay is a raster layer available to viewport capture',()=>{
 const f=fixture();assert.equal(f.overlay.tagName,'CANVAS');assert.ok(f.strokes.length>0,'visible grips are painted into the capture source');f.gizmo.dispose();assert.equal(f.viewport.querySelectorAll().length,1);
});
test('helper-visible vantage includes the transform overlay and clean helper suppression excludes it',()=>{
 const f=fixture();const picture=()=>composeViewport({document:f.document,window:f.window,viewport:f.viewport,hostCanvas:f.host,maxSize:2000});
 assert.deepEqual(picture().layers,['host','transform-gizmo-overlay']);f.gizmo.getHelper().visible=false;f.scene.updateMatrixWorld(true);assert.deepEqual(picture().layers,['host']);
});
test('Notes can include the displayed transform layer while clean authored captures omit it',()=>{
 const f=fixture();f.draws.length=0;
 const note=captureComposedCanvases({host:f.host,editorOverlay:f.overlay,document:f.document,label:'note'});
 assert.deepEqual(f.draws.map(call=>call[0]),[f.host,f.overlay]);assert.ok(note.layers.includes('editor-transform-gizmo'));
 f.draws.length=0;const clean=captureComposedCanvases({host:f.host,document:f.document,label:'shot'});assert.deepEqual(f.draws.map(call=>call[0]),[f.host]);assert.deepEqual(clean.layers,['mesh']);
 f.draws.length=0;f.gizmo.getHelper().visible=false;f.scene.updateMatrixWorld(true);captureComposedCanvases({host:f.host,editorOverlay:f.overlay,document:f.document,label:'note'});assert.deepEqual(f.draws.map(call=>call[0]),[f.host]);
});
