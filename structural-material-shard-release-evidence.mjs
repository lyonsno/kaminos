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
 const probes=signals.filter(s=>s.type==='after-up');if(!probes.length||probes.some(s=>s.closed!==true||s.moveRejected!==true))errors.push('Released input closure was not observed');
 return errors;
}
