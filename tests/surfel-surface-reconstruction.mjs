// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Color} from '../lib/three.core.js';
import {createSurfelGlass} from '../trellis-surfel-glass.mjs';

test('nested surface passes override and restore opaque-only host state, including on failure',()=>{
 const c=createSurfelGlass(new Float32Array([0,0,0,0,0,1,1,.5,0,.1,.2,.3]),{count:1,stride:12,radius:.01});
 const host={width:64,height:32},mrt={},fn=()=>{},camera=new PerspectiveCamera();
 let target=host,currentMRT=mrt,currentFn=fn,clear=new Color(.1,.2,.3),alpha=.7,calls=0,fail=true;
 const r={opaque:true,transparent:false,autoClear:false,getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},getMRT:()=>currentMRT,setMRT:m=>{currentMRT=m;},getRenderObjectFunction:()=>currentFn,setRenderObjectFunction:f=>{currentFn=f;},getClearColor:c=>c.copy(clear),getClearAlpha:()=>alpha,setClearColor:(c,a)=>{clear=new Color(c);alpha=a;},render(){calls++;assert.equal(this.transparent,true);assert.equal(this.opaque,true);assert.equal(currentMRT,null);assert.equal(currentFn,null);if(fail)throw Error('injected render failure');}};
 const draw=()=>c.root.children[0].onBeforeRender(r,null,camera);
 const restored=()=>{assert.equal(target,host);assert.equal(currentMRT,mrt);assert.equal(currentFn,fn);assert.equal(r.transparent,false);assert.equal(r.autoClear,false);assert.equal(alpha,.7);assert.deepEqual(clear,new Color(.1,.2,.3));};
 assert.throws(draw,/injected/);restored();assert.equal(c.read().surface.updates,0);
 fail=false;draw();restored();assert.equal(c.read().surface.updates,1);assert.equal(calls,5);
 draw();assert.equal(calls,5);camera.position.x=1;camera.updateMatrixWorld();draw();assert.equal(calls,9);
 c.set({reconstruction:false});draw();assert.equal(calls,9);c.set({reconstruction:true});draw();assert.equal(calls,13);
 c.dispose();
});
