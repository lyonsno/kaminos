// kaminos-test: node
import assert from 'node:assert/strict';
import {pressureResidualProbeDisposition} from '../volume-core.js';
import {flamePropertyApplies} from '../flame-authoring.mjs';
assert.equal(pressureResidualProbeDisposition({independentVelocity:true}),'unavailable','Shared-grid residual is unavailable during independent velocity');
assert.equal(pressureResidualProbeDisposition({independentVelocity:true,mapPending:true}),'unavailable','Pending old map cannot restore a shared-grid residual');
for(const mode of ['off','on'])assert.equal(flamePropertyApplies('volume-intermediate-material',{intermediateMode:mode}),false,'Inactive material controls must not imply a live effect');
assert.equal(flamePropertyApplies('volume-intermediate-material',{intermediateMode:'fields'}),true);
