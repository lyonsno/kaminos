// kaminos-test: node
import assert from 'node:assert/strict';
import {detailForceContributionMask,detailForceContributionReceipt} from '../volume-detail-force-isolation.mjs';
assert.deepEqual(detailForceContributionMask(),[0,0,1,0]);
assert.deepEqual(detailForceContributionMask({swirlJostle:2,microdetail:5,fireLicks:10}),[0,0,1,0]);
assert.deepEqual(detailForceContributionReceipt().effectiveMask,[0,0,1,0]);
