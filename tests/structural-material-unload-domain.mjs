import fs from 'node:fs';
import assert from 'node:assert/strict';
const r=JSON.parse(fs.readFileSync(process.argv[2]));
const w=r.failureState??r.observations?.find(o=>o.name==='released')?.effective;
assert.ok(w?.state?.stresses,'Observed post-unload native material state required');
const invalid=w.state.stresses.flatMap((s,i)=>s.invalid?[i]:[]);
assert.equal(invalid.length,0,`Unloading must retain an admissible active material field; inverted elements: ${invalid.join(',')}`);
console.log('Observed unload retains valid active material deformation');
