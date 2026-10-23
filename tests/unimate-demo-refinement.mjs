// kaminos-test: node
import assert from 'node:assert/strict';
import {createRefinementHistory} from '../models/unimate/unimate-refinement.js';
const h=createRefinementHistory();const first=h.begin({prompt:'walk',seed:1});h.append({t:0,motion:{positions:[1]}});h.append({t:.5,motion:{positions:[2]}});assert.throws(()=>h.append({t:.4}),/advance/);h.finish('stopped');assert.equal(first.status,'stopped');assert.equal(first.samples.length,2);h.begin({prompt:'walk',seed:2});h.append({t:1,motion:{positions:[3]}});h.finish('completed');assert.equal(h.runs.length,2);assert.equal(first.samples[0].motion.positions[0],1);assert.equal(h.active,null);
console.log('demo refinement retains stopped and finished histories without creating clips');
