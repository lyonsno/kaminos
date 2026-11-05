import assert from 'node:assert/strict';
import {BURN_STRUCTURE_IDENTITY,sectionReference} from '../burn-structure-core.mjs';
export function validateBurnStructureSnapshot(snapshot){
 const structure=snapshot?.structure;
 assert.equal(structure?.identity,BURN_STRUCTURE_IDENTITY,'Actual resident structural output required');
 assert.ok(structure.steps>0,'Structural GPU reduction must have executed');
 assert.ok(structure.sections?.length>0,'A missing or empty structural output is not evidence');
 assert.equal(structure.sections.length,structure.mapping?.connections?.length);
 const expected=sectionReference(structure.mapping,snapshot.material);
 assert.ok(expected.some(s=>s.mapped),'No sections intersect the occupied material');
 for(let i=0;i<expected.length;i++){
  const a=structure.sections[i],b=expected[i];assert.equal(a.id,b.id);assert.equal(a.mapped,b.mapped);
  if(!b.mapped){assert.equal(a.fraction,null);continue;}
  for(const key of ['fraction','remainingArea','sampledArea'])assert.ok(Number.isFinite(a[key])&&Math.abs(a[key]-b[key])<=1e-5*Math.max(1,Math.abs(b[key])),`${a.id} ${key}: ${a[key]} versus ${b[key]}`);
 }
 return {sections:expected.length,mapped:expected.filter(s=>s.mapped).length,minFraction:Math.min(...expected.filter(s=>s.mapped).map(s=>s.fraction))};
}
