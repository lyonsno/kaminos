import assert from 'node:assert/strict';
import * as evidence from '../structural-material-solid-resident-evidence.mjs';
assert.ok(evidence.inspectResidentCoverage,'Resident evidence must reject missing or duplicate candidate returns');
const models=[{kind:'graph'},{kind:'pmb'}];
for(const results of [[],[{kind:'graph',stages:[]}],[{kind:'graph',stages:[]},{kind:'graph',stages:[]}],[{kind:'graph',stages:[]},{kind:'pmb',stages:[]}]])assert.ok(evidence.inspectResidentCoverage(models,results).length);
const stages=['rest','loaded','damaged','post-damage','released'].map(name=>({name,state:{}}));
assert.deepEqual(evidence.inspectResidentCoverage(models,[{kind:'graph',stages},{kind:'pmb',stages}]),[]);
console.log('Missing, partial and duplicate resident evidence cannot pass');
