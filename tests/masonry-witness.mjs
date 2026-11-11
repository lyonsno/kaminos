// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertMasonryWorkshopState} from '../masonry-workshop-witness.mjs';
const valid=()=>({schema:'kaminos.masonry-workshop.v1',display:'source',source:{relief:.025},stones:[1,2,3,4].map(id=>({id:String(id),triangles:10,regions:{face:4,margin:4,corner:2}})),representations:{nvidia:'unimplemented',sbtf:'unimplemented',appearance:'ordinary PBR baseline'}});
test('masonry witness rejects wrong routes, missing sources and stale display/config',()=>{
 assert.equal(typeof assertMasonryWorkshopState,'function');
 assert.doesNotThrow(()=>assertMasonryWorkshopState(valid(),{display:'source',relief:.025}));
 for(const change of [{schema:'other'},{stones:[]},{display:'regions'},{source:{relief:0}},{representations:{nvidia:'trained',sbtf:'unimplemented'}}])assert.throws(()=>assertMasonryWorkshopState({...valid(),...change},{display:'source',relief:.025}));
 assert.throws(()=>assertMasonryWorkshopState({...valid(),stones:[{id:'1',triangles:0,regions:{}}]},{display:'source',relief:.025}));
});

import {assertMasonryBrowserValidation} from '../masonry-workshop-witness.mjs';
test('destroyed GPU buffers cannot count as a successful masonry browser run',()=>{
 assert.throws(()=>assertMasonryBrowserValidation('GPUDevice: Buffer used in submit while destroyed.'),/GPU buffer/);
 assert.doesNotThrow(()=>assertMasonryBrowserValidation('CVDisplayLinkCreateWithCGDisplay failed'));
});

test('zero rich regions are valid when all actual triangles belong to the face',()=>{
 const state=valid();for(const s of state.stones)s.regions={face:10,margin:0,corner:0};assert.doesNotThrow(()=>assertMasonryWorkshopState(state));
 state.stones[0].regions.face=0;assert.throws(()=>assertMasonryWorkshopState(state),'blank region accounting cannot pass');
});
