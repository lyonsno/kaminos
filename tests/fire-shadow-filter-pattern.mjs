// kaminos-test: node
import assert from 'node:assert/strict';
import * as filter from '../fire-shadow-filter.mjs';
import {complementaryDiskSample} from '../fire-shadow-sampling.mjs';
assert.equal(typeof filter.createShadowFilterPattern,'function','invariant complementary offsets must have a shared uniform representation');
for(const count of [1,2,3,6,16,17]){
  const pattern=filter.createShadowFilterPattern(count,{maxUniformBufferBindingSize:65536});
  assert.equal(pattern.route,'uniform');assert.equal(pattern.count,count);
  assert.equal(pattern.bytes,16*count*16);
  assert.equal(pattern.node.isBufferNode,true);
  for(let y=0;y<4;y++)for(let x=0;x<4;x++)for(let i=0;i<count;i++){
    const offset=((y*4+x)*count+i)*4,expected=complementaryDiskSample(i,x,y,count);
    assert(Math.abs(pattern.node.value[offset]-expected[0])<6e-8);
    assert(Math.abs(pattern.node.value[offset+1]-expected[1])<6e-8);
    assert.deepEqual([...pattern.node.value.slice(offset+2,offset+4)],[0,0]);
  }
}
assert.equal(filter.createShadowFilterPattern(16,{maxUniformBufferBindingSize:4096}).route,'uniform');
const overflow=filter.createShadowFilterPattern(17,{maxUniformBufferBindingSize:4096});
assert.equal(overflow.route,'arithmetic');assert.equal(overflow.count,17,'binding capacity must not silently reduce the requested taps');
assert.equal(overflow.reason,'uniform-binding-capacity');assert.equal(overflow.node,null);
assert.equal(filter.createShadowFilterPattern(2).reason,'device-limit-unavailable');
assert.throws(()=>filter.createShadowFilterPattern(0),/positive integer/);
console.log('PASS complementary uniform offsets match all phases and preserve counts on fallback');
