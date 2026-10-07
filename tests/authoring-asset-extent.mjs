import test from'node:test';import assert from'node:assert/strict';import*as assets from'../authoring-assets.mjs';
test('asset extent uses upward drag and preserves space for the viewport and narrow hierarchy',()=>{
 assert.equal(typeof assets.assetPaneHeight,'function','asset pane requires an adjustable extent');
 assert.equal(assets.assetPaneHeight(430,1050,false),430);assert.equal(assets.assetPaneHeight(2000,1050,false),828);assert.equal(assets.assetPaneHeight(10,1050,false),160);assert.equal(assets.assetPaneHeight(2000,900,true),498);
});
