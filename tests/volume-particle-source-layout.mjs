// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {splitArenaLayout} from '../volume-split-integral.mjs';
test('particle source producer stores one fresh local source, separate emission and no pixel history',()=>{
 const layout=splitArenaLayout(7,5,8,3,{sourcesOnly:true});
 assert.equal(layout.bankBytes,7*5*64);
 assert.equal(layout.historyBytes,7*5*64);
 assert.equal(layout.bytes,7*5*64+11*16);
 assert.equal(layout.worldOffset,7*5*4);
});
