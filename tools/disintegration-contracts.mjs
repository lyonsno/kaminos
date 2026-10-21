import assert from 'node:assert/strict';
export function checkDisintegrationEvidence(r){
 assert.equal(r.kernel?.status,'passed');assert.ok(r.kernel.records?.length>=5);
 assert.match(r.effective?.backend??'',/WebGPU/);assert.equal(r.effective.grid,32);assert.equal(r.effective.rays,28);assert.equal(r.effective.radius,.1);assert.equal(r.effective.gi.steps,4);assert.equal(r.effective.gi.slices,3);
 assert.deepEqual(r.errors,[]);assert.deepEqual(r.httpFailures,[]);
 const one=name=>{const matches=r.frames.filter(f=>f.name===name);assert.equal(matches.length,1,'Missing or duplicate '+name);return matches[0];};
 const cold=one('cold'),final=one('consumed'),reset=one('reset');
 assert.ok(cold.attached>0&&cold.solidCells>0);assert.equal(cold.detached,0);assert.equal(cold.gas,0);
 assert.ok(final.detached>0&&final.attached<cold.attached);assert.equal(final.attached+final.detached,cold.attached);
 assert.ok(final.solidCells<cold.solidCells);assert.equal(final.state.burner,false);
 assert.equal(reset.detached,0);assert.equal(reset.attached,cold.attached);assert.equal(reset.gas,0);
 for(const frame of r.frames){
  assert.equal(frame.state.fluid?.error??null,null,'Recorded volume runtime error');
  assert.equal(frame.state.fluid?.active,true,'Volume must remain active during burn evidence');
  assert.ok([frame.attached,frame.detached,frame.gas,frame.attachedFuel,frame.residue,frame.solidCells].every(Number.isFinite));
  assert.ok(Math.abs(frame.gas+frame.attachedFuel+frame.residue-cold.attached)<.002);
 }
 return true;
}
