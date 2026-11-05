// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseAshAttributes} from '../ash/gpu-disposal.mjs';
test('geometry-owned indirect storage may already be released; live compute buffers release exactly once',()=>{
 const released={},live={},data=new Map([[released,{}],[live,{buffer:{}}]]);let calls=0;
 const backend={get:a=>data.get(a)??{},destroyAttribute:a=>{assert.ok(data.get(a)?.buffer);calls++;data.delete(a);}};
 releaseAshAttributes({backend},[released,live]);releaseAshAttributes({backend},[released,live]);assert.equal(calls,1);
});
