// kaminos-test: node
import assert from 'node:assert/strict';
import {createPlaceAuthoring, initialPlace, planPlace, samplePlace} from '../stockroom-place-state.mjs';

const seed = initialPlace();
seed.realization = 'deck';
seed.regions[0].west = [[-1, 0], [1, 0]];
seed.regions.push({id:'opening', role:'space', shape:'box', center:[-1.45,0], half:[.27,.16]});
const author = createPlaceAuthoring(seed);
const state = () => author.model();
const occupied = (x,z) => samplePlace(state(),x,z) < 0;
const take = (z,reach,dx) => {
  author.begin({kind:'span',id:'dock',z,reach});
  author.preview(dx);
};
const original = planPlace(state());
take(0,.75,-.75);
assert.equal(occupied(-3.6,0),true);
assert.equal(occupied(-3.6,.9),false);
assert.equal(occupied(-1.45,0),false);
const wide = planPlace(state());
assert.ok(wide.bounds.min[0] < original.bounds.min[0]);
assert.ok(wide.frame.some(m => m.id.startsWith('post:0:') && m.position[0] < -3.3));
const untouched = m => Math.abs(m.position[2]) > .95;
assert.deepEqual(wide.boards.filter(untouched),original.boards.filter(untouched));
author.preview(-.4);
assert.equal(occupied(-3.6,0),false,'previews are relative to the press, not cumulative');
author.preview(-.75);
author.commit();
const broad = state();
take(.15,.27,.32);
assert.equal(occupied(-3.6,.15),false);
assert.equal(occupied(-3.6,-.25),true,'refining one stretch does not move another');
author.cancel();
assert.deepEqual(state(),broad);
take(.15,.27,.32);
author.commit();
assert.equal(author.read().depth,2);
author.back();
assert.deepEqual(state(),broad);
take(0,.3,-.1);
author.preview(0);
author.commit();
assert.equal(author.read().depth,1,'a plain press and release is not an edit');
author.back();
assert.deepEqual(planPlace(state()),original);
author.reset();
assert.deepEqual(state().regions,seed.regions);

assert.throws(() => author.begin({kind:'span',id:'extension',z:0,reach:.3}),/prepared/);
assert.throws(() => author.begin({kind:'span',id:'dock',z:0,reach:0}),/reach/);
assert.throws(() => createPlaceAuthoring({...seed,regions:[{...seed.regions[0],west:[[-1,0],[1,0],[0,1]]}]}),/profile/);

take(0,.75,100);
assert.equal(occupied(-1.45,0),false);
assert.equal(occupied(-1.1,0),true,'inward edit cannot eat the opening or its surrounding deck');
for (const m of planPlace(state()).boards) {
  for (const dx of [-1,1]) for (const dz of [-1,1]) {
    assert.ok(samplePlace(state(),m.position[0]+dx*m.size[0]/2,m.position[2]+dz*m.size[2]/2) <= 1e-8);
  }
}
console.log('stockroom direct span: retained outline, deck and supports, local second edit, cancellation and limits');
