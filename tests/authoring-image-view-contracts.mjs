// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as view from '../authoring-generate-layout.mjs';
const selected={kind:'image',source:'/original.png',name:'kettle'};
test('image display preference changes the shown source without changing the prepared mesh input',()=>{
 assert.equal(typeof view.generationImageView,'function','Generate needs a shared original/cutout display resolver');
 const input={selected,preparedSource:'/cutout.png',showSegmented:true};
 assert.equal(view.generationImageView(input).source,'/cutout.png');
 assert.equal(view.generationImageView({...input,showSegmented:false}).source,'/original.png');
 assert.equal(input.preparedSource,'/cutout.png');
 assert.equal(view.generationImageView({...input,preparedSource:null}).source,'/original.png','original stays visible while segmentation runs');
 assert.equal(view.generationImageView({...input,selected:{...selected,source:'/next.png'},showSegmented:false}).source,'/next.png');
});
test('a partial image is labeled as provisional and a held image has no displayed source',()=>{
 assert.equal(typeof view.generationImageView,'function');
 const preview={kind:'partial',width:1,height:1,rgba:new Uint8ClampedArray([1,2,3,255]),step:2,steps:4};
 const result=view.generationImageView({selected,preview,showSegmented:true});assert.equal(result.preview,preview);assert.match(result.label,/preview.*2.*4/i);
 const held=view.generationImageView({selected:{...selected,visibility:{status:'withheld'}},preparedSource:'/cutout.png',showSegmented:false});assert.equal(held.source,null);
});
