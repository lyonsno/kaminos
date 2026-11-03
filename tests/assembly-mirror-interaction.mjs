// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createBodyView} from '../experiments/link-workshop/bodies.mjs';
import {createMirrorTool} from '../experiments/link-workshop/mirror-tool.mjs';
import {furnaceAssembly} from '../experiments/link-workshop/furnace.mjs';
const fixture=furnaceAssembly({mirrored:true}),root=new T.Group(),scene=new T.Scene();scene.add(root);
const bodies=createBodyView(root);bodies.update(fixture.recipe,0);bodies.importBodies(fixture.geometry);
const lever=bodies.bodyMeshes('link:1',['Side operating lever'])[0];
assert.deepEqual(bodies.bodySelection(lever).names,['Side operating lever'],'A reflected part must remain separately selectable');
const relatedAssets=[],assets=[];let serial=0;
const tool=createMirrorTool({root,view:{...bodies,bodyManifest:bodies.manifest},session:{redraw(){}},host:{scene:{async open(){let owned;return {async attach(mesh){scene.add(mesh);owned={id:'plane'+(++serial),root:mesh};assets.push(owned);return owned;},async dispose(){owned?.root.removeFromParent();}};}}},win:{kaminosSelection:{set(){}}},relatedAssets,ensure(){},apply:p=>bodies.importBodies(p)});
const first=await tool.place();assert.equal(relatedAssets[0].id,first.planeObjectId,'Plane belongs to the assembly inspector');
assets[0].root.removeFromParent();assert.equal(tool.state().planeObjectId,null);
const second=await tool.place();assert.notEqual(first.planeObjectId,second.planeObjectId);assert.equal(relatedAssets.length,1);
tool.select([{id:'link:1',names:['Side operating lever']},{id:'link:1'}]);assert.equal(tool.state().selected.length,1,'Whole body subsumes its selected part');
await tool.copy();tool.clear();assert.deepEqual(tool.state().selected,[]);
await tool.dispose();bodies.dispose();console.log('Mirror selection, related inspector and deleted-plane recovery pass');
