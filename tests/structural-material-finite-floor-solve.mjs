import assert from 'node:assert/strict';
import fs from 'node:fs';
import {solidResidentWgsl} from '../structural-material-solid-resident.js';
assert.ok(solidResidentWgsl.includes('candidate.y=max(candidate.y,diagnostics[i*6u+4u].w)'), 'Finite floor feasibility must participate in each local solve, not fight it only after integration');
assert.ok(solidResidentWgsl.includes('diagnostics[base+4u].w'), 'Explicit diagnosis must preserve the resident floor bound');
const source=fs.readFileSync(new URL('../structural-material-solid-resident.js',import.meta.url),'utf8');
assert.ok(source.includes('enableFiniteFloor('),'Explicit opt-in must preserve other solver consumers');
console.log('Finite-floor solve participates in feasibility, survives diagnosis and is explicitly enabled');
