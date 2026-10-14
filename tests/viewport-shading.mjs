// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedViewportDisplay,viewportShortcut} from '../viewport-display-settings.mjs';
import {createViewportShading} from '../viewport-shading.mjs';

const node=(props={},children=[])=>({...props,userData:props.userData??{},children,traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}});
const factory=()=>{const made=[];return {made,make:source=>{const wire={wireframe:true,source};made.push(wire);return wire;}};};

test('shading is a validated viewport preference toggled by Shift Z',()=>{
 assert.equal(checkedViewportDisplay().shading,'solid');
 assert.equal(checkedViewportDisplay({shading:'wireframe'}).shading,'wireframe');
 assert.throws(()=>checkedViewportDisplay({shading:'xray'}),/shading/);
 assert.equal(viewportShortcut({code:'KeyZ',shiftKey:true}),'shading');
 assert.equal(viewportShortcut({code:'KeyZ',shiftKey:true,metaKey:true}),null,'Cmd Shift Z stays redo');
 assert.equal(viewportShortcut({code:'KeyZ',shiftKey:true,altKey:true}),'overlays');
});

test('wireframe swaps scene meshes, reuses one wire per source material, and restores originals',()=>{
 const f=factory(),shading=createViewportShading({makeWireMaterial:f.make});
 const shared={name:'shared'},solo={name:'solo'},multi=[{name:'a'},shared];
 const a=node({isMesh:true,material:shared}),b=node({isMesh:true,material:shared}),c=node({isMesh:true,material:multi});
 const editor=node({isMesh:true,material:solo,userData:{kaminosEditorOnly:true}});
 const lines=node({isLineSegments:true,material:solo});
 const root=node({},[a,node({},[b,c]),editor,lines]);
 assert.deepEqual(shading.apply([root],'wireframe'),{mode:'wireframe',swapped:3});
 assert.equal(a.material,b.material,'shared source material shares one wire material');
 assert.equal(a.material.source,shared);
 assert.deepEqual(c.material.map(m=>m.source),multi);
 assert.equal(c.material[1],a.material);
 assert.equal(editor.material,solo,'editor-only helpers keep their material');
 assert.equal(lines.material,solo,'non-mesh primitives are untouched');
 assert.equal(f.made.length,2);
 assert.deepEqual(shading.apply([root],'wireframe'),{mode:'wireframe',swapped:3},'reapplying is idempotent');
 assert.equal(f.made.length,2);
 assert.deepEqual(shading.apply([root],'solid'),{mode:'solid',swapped:0});
 assert.equal(a.material,shared);assert.equal(b.material,shared);assert.equal(c.material,multi);
});

test('meshes added while in wireframe are picked up and an external material change is kept',()=>{
 const f=factory(),shading=createViewportShading({makeWireMaterial:f.make});
 const first={name:'first'},late={name:'late'},edited={name:'edited'};
 const a=node({isMesh:true,material:first}),root=node({},[a]);
 shading.apply([root],'wireframe');
 const added=node({isMesh:true,material:late});root.children.push(added);
 assert.equal(shading.apply([root],'wireframe').swapped,2);
 assert.equal(added.material.source,late);
 a.material=edited;
 shading.apply([root],'wireframe');
 assert.equal(a.material.source,edited,'a material replaced during wireframe becomes the restore target');
 shading.apply([root],'solid');
 assert.equal(a.material,edited);assert.equal(added.material,late);
});

test('meshes that left the scene are still restored when returning to solid',()=>{
 const shading=createViewportShading({makeWireMaterial:factory().make});
 const original={name:'kept'},a=node({isMesh:true,material:original});
 shading.apply([node({},[a])],'wireframe');
 shading.apply([],'solid');
 assert.equal(a.material,original);
});
