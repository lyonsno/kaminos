// kaminos-test: node
import assert from 'node:assert/strict';
import * as probe from '../tools/burn-region-thermal-probe.mjs';
assert.equal(typeof probe.checkedRegionalAdapter,'function','Require verified effective native adapter identity');
const info={vendor:'apple',description:'Metal',isFallbackAdapter:false};
assert.equal(probe.checkedRegionalAdapter({info}).isFallbackAdapter,false);
assert.throws(()=>probe.checkedRegionalAdapter({info:{...info,isFallbackAdapter:true}}),/native/i);
assert.throws(()=>probe.checkedRegionalAdapter({info:{vendor:'apple'}}),/native/i);
assert.throws(()=>probe.checkedRegionalAdapter(null),/native/i);
assert.equal(probe.checkedRegionalAdapter({info:{vendor:'apple'},isFallbackAdapter:false}).isFallbackAdapter,false);
