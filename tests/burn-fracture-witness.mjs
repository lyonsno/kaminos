// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkBurnFractureObservation} from '../tools/burn-fracture-contract.mjs';
const read={identity:'kaminos.burn-fracture.replay.v1',effective:{backend:'WebGPU',adapter:{vendor:'apple'}},thermal:'frozen-not-live-coupled',mechanics:{identity:'kaminos.burn-fracture.resident-cohesive.v1',runtimeReadbacks:0,regions:2,connections:1}};
const snapshot={matrices:new Array(32).fill(0),positions:new Array(8).fill(0),quaternions:[0,0,0,1,0,0,0,1],velocities:new Array(8).fill(0),angularVelocities:new Array(8).fill(0),alive:[true],geometry:new Array(12).fill(0),state:{seconds:0}};
checkBurnFractureObservation(read,snapshot);
for(const effective of [{backend:'WebGL',adapter:{vendor:'apple'}},{backend:'WebGPU',adapter:{vendor:'google'}},{backend:'WebGPU',adapter:null}])assert.throws(()=>checkBurnFractureObservation({...read,effective},snapshot));
for(const patch of [{matrices:[]},{positions:[]},{alive:[]},{geometry:[]},{quaternions:new Array(8).fill(0)},{velocities:[NaN,...snapshot.velocities.slice(1)]}])assert.throws(()=>checkBurnFractureObservation(read,{...snapshot,...patch}));
const out=fs.mkdtempSync(path.join(os.tmpdir(),'burn-fracture-failed-input-'));
assert.equal(spawnSync(process.execPath,[new URL('../tools/burn-fracture-witness.mjs',import.meta.url).pathname,'http://127.0.0.1:1',out]).status,1);
const failed=JSON.parse(fs.readFileSync(path.join(out,'report.json')));assert.equal(failed.status,'failed');assert.equal(failed.phase,'launch');assert.ok(failed.error);assert.deepEqual(failed.observations,[]);
