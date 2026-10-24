// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,advance,checkpoint,restore,mineralMass} from '../mineral-worlds/state.mjs';
for(const kind of ['flowstone','salt']) {
 test(`${kind}: deposition retains mineral accounting and positive state`,()=>{
  const s=createWorld({kind,size:12,depth:4});advance(s,240);
  assert.ok(s.solid.some(v=>v>0),'mineral must precipitate onto the retained surface');
  assert.ok(Math.abs(mineralMass(s)-(s.ledger.initial+s.ledger.incoming-s.ledger.outgoing))<1e-8,'mineral budget must close');
  for(const key of ['solid','water','solute','brine'])assert.ok(s[key].every(v=>Number.isFinite(v)&&v>=0),key);
 });
 test(`${kind}: restored evolved state continues exactly`,()=>{
  const s=createWorld({kind,size:10,depth:4});advance(s,35);const r=restore(checkpoint(s));
  advance(s,31);advance(r,31);assert.deepEqual(checkpoint(s),checkpoint(r));
 });
}
test('deposited relief changes subsequent water transport',()=>{
 const a=createWorld({size:12}),b=restore(checkpoint(a));for(let x=0;x<12;x++)b.solid[6*12+x]=.25;
 advance(a,12);advance(b,12);assert.notDeepEqual(a.water,b.water);
});
test('invalid checkpoints fail visibly',()=>{
 const s=checkpoint(createWorld({size:8}));s.solid.pop();assert.throws(()=>restore(s),/solid/);
});

test('invalid seed cannot introduce NaNs into a new world',()=>{
 assert.throws(()=>createWorld({size:8,seed:NaN}),/seed/);
});

test('saved process/grid identity cannot fall back to new-world defaults',()=>{
 for(const key of ['kind','size','depth']){const file=checkpoint(createWorld({kind:'salt',size:48,depth:6}));delete file[key];assert.throws(()=>restore(file),/identity|grid|kind/);}
});
