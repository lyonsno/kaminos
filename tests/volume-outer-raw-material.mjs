import assert from 'node:assert/strict';
import {outerSmokeConfig} from '../volume-outer-smoke.mjs';
assert.equal(outerSmokeConfig().materialMode,'optical-only');
assert.equal(outerSmokeConfig({materialMode:'authored-raw'}).materialMode,'authored-raw');
assert.throws(()=>outerSmokeConfig({materialMode:'reactant'}),/material mode/);
assert.throws(()=>outerSmokeConfig({materialMode:null}),/material mode/);
console.log('explicit authored raw material admission passed');
