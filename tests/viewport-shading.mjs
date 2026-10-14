// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedViewportDisplay,viewportShortcut,VIEWPORT_SHADING_TOGGLE_HTML} from '../viewport-display-settings.mjs';
import {createViewportShading} from '../viewport-shading.mjs';

const node=(props={},children=[])=>({...props,userData:props.userData??{},children,traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}});
const wire={name:'wire',wireframe:true};

test('shading is a validated viewport preference toggled by Shift Z',()=>{
 assert.equal(checkedViewportDisplay().shading,'solid');
 assert.equal(checkedViewportDisplay({shading:'wireframe'}).shading,'wireframe');
 assert.throws(()=>checkedViewportDisplay({shading:'xray'}),/shading/);
 assert.equal(viewportShortcut({code:'KeyZ',shiftKey:true}),'shading');
 assert.equal(viewportShortcut({code:'KeyZ',shiftKey:true,metaKey:true}),null,'Cmd Shift Z stays redo');
 assert.equal(viewportShortcut({code:'KeyZ',shiftKey:true,altKey:true}),'overlays');
 assert.match(VIEWPORT_SHADING_TOGGLE_HTML,/class="viewport-shading"/);
 assert.doesNotMatch(VIEWPORT_SHADING_TOGGLE_HTML,/\bid=/,'each toolbar gets its own instance, so the markup carries no id');
});

test('wire materials exist only inside the viewport render',()=>{
 const shading=createViewportShading({wireMaterial:wire});
 const shared={name:'shared'},solo={name:'solo'},multi=[{name:'a'},shared];
 const a=node({isMesh:true,material:shared}),b=node({isMesh:true,material:shared}),c=node({isMesh:true,material:multi});
 const editor=node({isMesh:true,material:solo,userData:{kaminosEditorOnly:true}}),lines=node({isLineSegments:true,material:solo});
 const first=node({},[a,editor,lines]),second=node({},[node({},[b,c])]);
 let during=null;
 const receipt=shading.renderWith([first,second],'wireframe',()=>{during={a:a.material,b:b.material,c:c.material,editor:editor.material,lines:lines.material};});
 assert.deepEqual(during,{a:wire,b:wire,c:[wire,wire],editor:solo,lines:solo});
 assert.deepEqual(receipt,{mode:'wireframe',meshes:3,perRoot:[1,2]});
 assert.equal(a.material,shared);assert.equal(b.material,shared);assert.equal(c.material,multi,'authored materials are back before anything else reads them');
});

test('authored materials are restored when the render throws',()=>{
 const shading=createViewportShading({wireMaterial:wire}),authored={name:'authored'},mesh=node({isMesh:true,material:authored});
 assert.throws(()=>shading.renderWith([node({},[mesh])],'wireframe',()=>{throw Error('frame failed');}),/frame failed/);
 assert.equal(mesh.material,authored);
});

test('solid renders without touching materials and edits between frames are kept',()=>{
 const shading=createViewportShading({wireMaterial:wire}),authored={name:'authored'},edited={name:'edited'},mesh=node({isMesh:true,material:authored}),root=node({},[mesh]);
 let seen=null;
 assert.deepEqual(shading.renderWith([root],'solid',()=>{seen=mesh.material;}),{mode:'solid',meshes:0,perRoot:[0]});
 assert.equal(seen,authored);
 mesh.material=edited;
 shading.renderWith([root],'wireframe',()=>{seen=mesh.material;});
 assert.equal(seen,wire);assert.equal(mesh.material,edited);
});

test('a mesh reached through two registered roots unwinds to its authored material',()=>{
 const shading=createViewportShading({wireMaterial:wire}),authored={name:'authored'},mesh=node({isMesh:true,material:authored}),inner=node({},[mesh]),outer=node({},[inner]);
 shading.renderWith([outer,inner],'wireframe',()=>{});
 assert.equal(mesh.material,authored);
});
