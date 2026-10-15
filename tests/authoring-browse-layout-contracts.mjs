// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as browse from '../authoring-browse-layout.mjs';
const {friendlyAssetTitle,thumbnailDistance}=browse;

test('generated names read as what they are, with the model as a badge',()=>{
 assert.deepEqual(friendlyAssetTitle('klein-a-weathered-bronze-lantern-with-a-glass-window-studio-photo-s98569696 · SF3D.glb'),
  {title:'Weathered bronze lantern with a glass window studio photo',badge:'SF3D'});
 assert.deepEqual(friendlyAssetTitle('klein-a-maquette-diorama-of-gentle-grasslands-on-a-short-round-dais-s42900803.png'),
  {title:'Maquette diorama of gentle grasslands on a short round dais',badge:'Klein'});
 assert.deepEqual(friendlyAssetTitle('lantern · TRELLIS.glb'),{title:'Lantern',badge:'TRELLIS'});
 assert.deepEqual(friendlyAssetTitle('02 Brutalist Cast Refractory Front 35deg · Input · SF3D.glb'),{title:'02 Brutalist Cast Refractory Front 35deg · Input',badge:'SF3D'});
 assert.deepEqual(friendlyAssetTitle('Saved mesh · ecbe00dc'),{title:'Saved mesh · ecbe00dc',badge:null});
 assert.deepEqual(friendlyAssetTitle('sf3d-demo-chair.glb'),{title:'Sf3d demo chair',badge:null});
 assert.deepEqual(friendlyAssetTitle(''),{title:'Untitled',badge:null});
});

test('mesh thumbnails frame the object box, not its bounding sphere',()=>{
 const fov=35,aspect=1;
 // A tall thin object: the sphere rule backs off by the diagonal; the box rule fits its height.
 const tall=thumbnailDistance({size:[0.4,2,0.4],fovDeg:fov,aspect,margin:1.08});
 const sphere=Math.hypot(0.4,2,0.4)/2/Math.sin(fov*Math.PI/360)*1.12;
 assert.ok(tall<sphere,`box framing (${tall.toFixed(2)}) is tighter than the sphere rule (${sphere.toFixed(2)})`);
 const halfV=Math.tan(fov*Math.PI/360);
 assert.ok(1/(tall-0.2)<=halfV*1.0001,'the full height stays inside the view');
 const wide=thumbnailDistance({size:[3,0.5,0.5],fovDeg:fov,aspect:1,margin:1});
 assert.ok(1.5/(wide-0.25)<=halfV*1.0001,'the full width stays inside a square view');
});
