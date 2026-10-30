// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {PerspectiveCamera,Object3D,Vector3,Vector4,Matrix4} from '../lib/three.core.js';
import {promptPlaneTransform} from '../kiln-prompt-editor.mjs';
test('native caret plane and solid glyph pixels agree under perspective, pose and resize',()=>{
 const camera=new PerspectiveCamera(50,16/9,.01,100);camera.position.set(2,1,6);camera.lookAt(0,0,0);
 const object=new Object3D();object.position.set(.3,-.4,.6);object.rotation.set(.1,.3,-.1);object.scale.set(1.3,.8,1);
 for(const [width,height,textHeight]of [[640,360,180],[1200,675,1000]]){
  const css=promptPlaneTransform({camera,object,width,height,textHeight}),matrix=new Matrix4().fromArray(css.slice(9,-1).split(',').map(Number));
  for(const [x,y]of [[0,0],[512,40],[1024,textHeight]]){
   const dom=new Vector4(x,y,0,1).applyMatrix4(matrix),world=new Vector3(-1+x/512,textHeight/1024-y/512,.018).applyMatrix4(object.matrixWorld).project(camera);
   assert.ok(Math.abs(dom.x/dom.w-(world.x+1)*width/2)<1e-9);assert.ok(Math.abs(dom.y/dom.w-(1-world.y)*height/2)<1e-9);
  }
 }
});
