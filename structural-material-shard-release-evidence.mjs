export function inspectClosedInput({inputs,signals}={}){
 const errors=[];
 if(!Array.isArray(inputs)||!inputs.length||!Array.isArray(signals)||!signals.length)return['Release input or native pointer evidence is missing'];
 const closed=new Set();let boundaries=0;
 for(const input of inputs){
  if(input?.kind==='gesture-finish-request'){
   const d=input.data;if(!Number.isInteger(d?.generation)||!Array.isArray(d.finalDisplacement)||d.finalDisplacement.length!==3||!d.finalDisplacement.every(Number.isFinite))errors.push('Release boundary generation/final input is incomplete');
   else{closed.add(d.generation);boundaries++;}
  }
  if(input?.kind==='move'){
   if(!Number.isInteger(input.data?.generation))errors.push('Input generation is missing');
   else if(closed.has(input.data.generation))errors.push('Closed gesture accepted later input');
  }
 }
 if(!boundaries)errors.push('No admitted release boundary');
 if(!signals.some((s,i)=>s.type==='pointerup'&&s.buttons===0&&signals.slice(i+1).some(after=>after.type==='pointermove'&&after.buttons===0)))errors.push('Native release followed by unheld cursor movement was not exercised');
 const probes=signals.filter(s=>s.type==='after-up');if(!probes.length||probes.some(s=>s.closed!==true||s.moveRejected!==true||s.finalVectorPreserved!==true))errors.push('Released input closure with preserved final vector was not observed');
 return errors;
}

// This probe may author an adversarial move only after the application admits release.
export function probeAdmittedRelease(api,expected){
 const equal=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===3&&b.length===3&&a.every((v,k)=>Number.isFinite(v)&&v===b[k]);
 const before=api.witness(),boundary=before.inputs?.findLast(i=>i.kind==='gesture-finish-request'),d=boundary?.data;
 const admitted=Number.isInteger(expected?.generation)&&d?.generation===expected.generation&&equal(d.finalDisplacement,expected.displacement)&&(!before.gesture||before.gesture.generation===expected.generation&&before.gesture.inputClosed===true);
 const result={type:'after-up',generation:expected?.generation,closed:Boolean(admitted),moveRejected:null,finalVectorPreserved:false,expected,observed:d??null};
 if(!admitted)return result;
 let error;try{api.move([.01,0,0]);result.moveRejected=false;}catch(e){error=e.message;result.moveRejected=/closed|No active picked patch/.test(error);}
 const after=api.witness(),latest=after.inputs?.findLast(i=>i.kind==='gesture-finish-request');
 result.finalVectorPreserved=latest?.data.generation===expected.generation&&equal(latest.data.finalDisplacement,expected.displacement)&&!after.inputs.slice(before.inputs.length).some(i=>i.kind==='move'&&i.data?.generation===expected.generation);
 if(error)result.rejection=error;return result;
}

export function inspectLoadedReleaseSources(expected,observed){
 if(!Array.isArray(expected)||!expected.length||!Array.isArray(observed))return['Loaded source expectations or observations are missing'];
 const errors=[];
 for(const wanted of expected){
  if(typeof wanted.name!=='string'||typeof wanted.url!=='string'||!/^[a-f0-9]{64}$/.test(wanted.sha256)){errors.push('Malformed source expectation');continue;}
  const matches=observed.filter(actual=>actual.url===wanted.url&&actual.name===wanted.name);
  if(!matches.length)errors.push(`Browser did not retain ${wanted.name}`);
  for(const actual of matches)if(actual.sha256!==wanted.sha256||!Number.isInteger(actual.bytes)||actual.bytes<=0||actual.status!==200)errors.push(`Browser-loaded source mismatch: ${wanted.name}`);
 }
 return errors;
}
