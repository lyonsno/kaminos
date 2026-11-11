// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertMasonryWorkshopState} from '../masonry-workshop-witness.mjs';
const valid=()=>({schema:'kaminos.masonry-workshop.v1',display:'source',source:{relief:.025},stones:[1,2,3,4].map(id=>({id:String(id),triangles:30,regions:{face:4,margin:4,corner:2}})),representations:{nvidia:'unimplemented',sbtf:'unimplemented',appearance:'ordinary PBR baseline'}});
test('masonry witness rejects wrong routes, missing sources and stale display/config',()=>{
 assert.equal(typeof assertMasonryWorkshopState,'function');
 assert.doesNotThrow(()=>assertMasonryWorkshopState(valid(),{display:'source',relief:.025}));
 for(const change of [{schema:'other'},{stones:[]},{display:'regions'},{source:{relief:0}},{representations:{nvidia:'trained',sbtf:'unimplemented'}}])assert.throws(()=>assertMasonryWorkshopState({...valid(),...change},{display:'source',relief:.025}));
 assert.throws(()=>assertMasonryWorkshopState({...valid(),stones:[{id:'1',triangles:0,regions:{}}]},{display:'source',relief:.025}));
});
