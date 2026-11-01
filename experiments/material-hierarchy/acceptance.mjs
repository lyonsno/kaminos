function finiteArray(value,length,label){
 if(!Array.isArray(value)||value.length!==length)throw Error(`${label} length must be ${length}`);
 for(let i=0;i<length;i++)if(!Number.isFinite(value[i]))throw Error(`${label}[${i}] must be finite`);
}
function positiveInteger(value,label){if(!Number.isSafeInteger(value)||value<1)throw Error(`${label} must be a positive integer`);}

// Validate the actual readback before tolerances: NaN comparisons do not fail,
// and JSON would turn a non-finite value into an ambiguous null.
export function validateNativeEvidence(result, {fieldLength} = {}) {
 positiveInteger(fieldLength,'Reference field length');
 if(!Array.isArray(result.reference)||result.reference.length!==2)throw Error('Expected two reference fields');
 for(let i=0;i<2;i++)finiteArray(result.reference[i],fieldLength,`reference ${i}`);
 if(!Array.isArray(result.steps)||result.steps.length!==6)throw Error('Expected six allocation steps');
 for(const [i,s] of result.steps.entries()){
  finiteArray(s.totals,8,`step ${i} totals`);
  positiveInteger(s.capacity,`step ${i} capacity`);positiveInteger(s.allocatedBricks,`step ${i} allocated bricks`);
  if(!s.snapshot||!Array.isArray(s.snapshot.nodes))throw Error(`step ${i} snapshot is missing`);
  if(s.snapshot.nodes.length!==s.allocatedBricks)throw Error(`step ${i} snapshot node length mismatch`);
  finiteArray(s.snapshot.values,s.capacity*64*8,`step ${i} snapshot pool`);
  finiteArray(s.snapshot.dims,3,`step ${i} snapshot dimensions`);
  if(s.snapshot.dims.some(n=>!Number.isSafeInteger(n)||n<1)||s.snapshot.dims.reduce((a,b)=>a*b,8)!==fieldLength)throw Error(`step ${i} snapshot dimensions differ from reference`);
  for(const n of s.snapshot.nodes){
   if(!Number.isSafeInteger(n.slot)||n.slot<0||n.slot>=s.capacity)throw Error(`step ${i} snapshot slot is invalid`);
   if(!Number.isFinite(n.pitch)||n.pitch<=0)throw Error(`step ${i} snapshot pitch must be finite and positive`);
   finiteArray(n.lo,3,`step ${i} snapshot origin`);
  }
 }
 let maximum=0;for(let i=0;i<fieldLength;i++)maximum=Math.max(maximum,Math.abs(result.reference[0][i]-result.reference[1][i]));
 if(!Number.isFinite(maximum))throw Error('Reference maximum error must be finite');
 result.referenceMaxError=maximum;
 if(result.referenceMaxError>1e-5)throw Error('Zero-budget native transport differs from dense reference: '+result.referenceMaxError);
 if(result.errors.length)throw Error(result.errors.join('\n'));
 if(!result.steps.some(s=>s.levels.some(l=>l.level>0)))throw Error('No material refinement executed');
 if(result.steps[3].levels.some(l=>l.level!==0))throw Error('Zero budget did not remove refinement');
 for(const s of result.steps)for(let ch=0;ch<8;ch++)if(Math.abs(s.totals[ch]-result.steps[0].totals[ch])>1e-4*Math.max(1,result.steps[0].totals[ch]))throw Error(`Reallocation changed channel ${ch} quantity`);
 for(const s of result.steps)if(s.error||s.allocatedBricks>s.capacity)throw Error('Allocator failed: '+JSON.stringify(s));
 return result;
}
