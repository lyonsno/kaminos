import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chooseComparisonLayout} from './layout.js';
test('arrangement maximizes photograph footprint rather than following a width breakpoint',()=>{
  assert.equal(chooseComparisonLayout(1400,900),'grid');
  assert.equal(chooseComparisonLayout(1800,600),'strip');
  assert.equal(chooseComparisonLayout(390,620),'grid');
  assert.equal(chooseComparisonLayout(1400,800,2),'grid');
  assert.equal(chooseComparisonLayout(1400,800,.5),'strip');
  assert.equal(chooseComparisonLayout(0,0),'grid');
});
