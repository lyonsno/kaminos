// kaminos-test: node
import assert from 'node:assert/strict';
import {createRefinementLayout} from '../ash/refinement-plan.mjs';
import {refinementArena} from '../ash/refinement-shader.mjs';
import {refinementVertexWGSL} from '../ash/refinement-surface.mjs';
import {TSL,WGSLNodeBuilder} from '../lib/three.webgpu.js';

const input={cellSize:.025,bounds:{min:[0,0,0],max:[12.8,2.4,6.4]},refinement:{ratio:2,mode:'adaptive',fineFraction:.125}};
const p=createRefinementLayout(input),before=structuredClone(p);
const compact=refinementArena(p,{surfaceEncoding:'cell-masks'});
assert.equal(compact.surfaceCache?.encoding,'cell-masks','explicit compact surface encoding must be honored');
assert.equal(compact.surfaceCache.words*4,24*1024**2,'the ten-kiln surface cache has a 24MiB reservation');
assert.equal(p.faceWords*4,150*1024**2,'saved physical layout retains its legacy derived fields');
delete p.adaptiveArena;assert.deepEqual(p,before,'derived surface encoding must not change saved physical layout');
const legacy=refinementArena(p),automatic=refinementArena(p,{surfaceEncoding:'auto'});
assert.equal(legacy.surfaceCache.encoding,'face-records');assert.equal(automatic.surfaceCache.encoding,'cell-masks');
assert.deepEqual(legacy.words,compact.words,'derived encoding preserves adaptive arena addresses and saved owner-map offsets');
const tiny=createRefinementLayout({cellSize:1,bounds:{min:[0,0,0],max:[2,2,2]},refinement:{ratio:2,mode:'adaptive',fineCapacity:1}});
assert.ok(refinementArena(tiny,{surfaceEncoding:'auto'}).surfaceCache.words<=tiny.faceWords,'automatic choice never increases surface reservation');
assert.throws(()=>refinementArena(p,{surfaceEncoding:'invented'}),/encoding/i);
for(const arena of [legacy,compact]){
 const call=TSL.wgslFn(refinementVertexWGSL(p,arena))({});
 assert.equal(call.getNodeType(new WGSLNodeBuilder(null,{})),'vec4','Three must select the physical vertex entry, not its address helper');
}
console.log('surface storage bounds and physical checkpoint identity pass');
