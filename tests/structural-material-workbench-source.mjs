import test from 'node:test';import assert from 'node:assert/strict';
const absent=()=>{throw Error('Shared stone composition is unavailable');};
const {composeStoneWorkbenchSource=absent}=await import('../tools/stone-workbench-source.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
test('composition refuses missing or duplicated source anchors rather than silently exposing a standalone page',()=>{assert.throws(()=>composeStoneWorkbenchSource(''),/anchor/);assert.throws(()=>composeStoneWorkbenchSource('let ownerExperimentEntry=null,\nlet ownerExperimentEntry=null,'),/anchor/);});
