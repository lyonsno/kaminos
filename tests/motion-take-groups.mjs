// kaminos-test: node
import assert from 'node:assert/strict';
import * as collection from '../experiments/creature-motion/motion-collection.mjs';
assert.equal(typeof collection.groupMotionTakes,'function','collection must group takes without duplicating completed histories');
const {groupMotionTakes}=collection;
const motion={prompt:'squat',seed:1,positions:[1,2],localRotations:[0,1],consumerReport:{solver:{rtol:.001,atol:.000001,cfgScale:3}}};
const rows=[{id:'a',skeletonKey:'one',motion},{id:'b',skeletonKey:'one',motion:{...motion,seed:2}},{id:'c',skeletonKey:'two',motion}];
const history={id:'old',skeletonKey:'one',prompt:'squat',seed:1,solver:motion.consumerReport.solver,status:'completed',samples:[{...motion,refinement:{t:1}}]};
let groups=groupMotionTakes(rows,[history]);
assert.equal(groups.length,2);assert.equal(groups[0].takes.length,2);assert.equal(groups[0].takes[0].history.id,'old');
const active={...history,id:'live',status:'running',samples:[]};
groups=groupMotionTakes(rows,[history,active]);assert.equal(groups[0].takes.length,2,'running generation belongs in pinned area');
const stopped={...history,id:'stop',status:'stopped'};
groups=groupMotionTakes(rows,[history,stopped]);assert.equal(groups[0].takes.length,3,'stopped history remains recoverable');
const mismatch={...history,samples:[{...motion,positions:[9,2],refinement:{t:1}}]};
assert.equal(groupMotionTakes(rows,[mismatch])[0].takes.length,3,'same settings cannot prove matching output');
assert.equal(groupMotionTakes(rows,[{...history,prompt:'different'}]).length,3);
console.log('prompt groups preserve variants, match exact legacy output, and separate live generation');
