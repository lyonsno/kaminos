import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the production contribution, not a duplicate visibility predicate.
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const expression=source.match(/const receiverSignal = ([\s\S]*?);/)[1];
const scalar=value=>({valueOf:()=>value,add:other=>scalar(value+Number(other)),mul:other=>scalar(value*Number(other))});
const evaluate=visibility=>Number(new Function('nearSignal','farSignal','backgroundMask','materialResponse','fireLightFieldStrength','fireShadowVisibility',`return ${expression}`)(...Array(5).fill(scalar(1)),scalar(visibility)));
assert.equal(evaluate(0),0,'a geometrically blocked receiver must receive neither near nor far fire light');
assert.equal(evaluate(1),2,'an unblocked receiver retains the original near plus far contribution');
assert.equal(evaluate(.5),1,'partial visibility attenuates only the fire contribution');
console.log('fire light-field shadow contribution contracts passed');
