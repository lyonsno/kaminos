export function inspectBoundedWitness(w,expected){
 const errors=[];
 if(w?.route!=='kaminos.picked-stone.bounded-shards.webgpu.v0'||w.phase!=='interactive'||w.failure)errors.push('Bounded interactive route unavailable');
 if(w?.identity?.backend!=='webgpu'||w.identity.adapterFallback!==false)errors.push('Native backend required');
 const s=w?.state,m=s?.model;
 if(s?.energyKernel!=='isotropic-degradation-v1'||s.constitutiveLayout!=='event-frozen-isotropic-degradation-v1')errors.push('Effective compact damage law missing');
 if(!m||!['points','elements','bonds'].every(k=>Number.isInteger(m[k])&&m[k]>0)||!Array.isArray(s?.state)||s.state.length!==m.points*16||!s.state.every(Number.isFinite)||!Array.isArray(s?.bonds)||s.bonds.length!==m.bonds*4||!s.bonds.every(Number.isFinite))errors.push('Complete finite material state required');
 if(expected&&['points','elements','bonds'].some(k=>m?.[k]!==expected[k]))errors.push('Mechanical counts changed');
 if(!Array.isArray(w?.pieces)||!w.pieces.length||w.pieces.some(p=>p.binding?.route!=='kaminos.deformable-surface.node-associated-four-split.v0'||!Array.isArray(p.renderedPositions)||p.renderedPositions.length<9||p.renderedPositions.length%9||!p.renderedPositions.every(Number.isFinite)||new Set(p.renderedPositions).size<2))errors.push('Nonempty finite bounded surfaces required');
 if(s?.stresses?.some(v=>v.active&&v.invalid))errors.push('Active material inversion');
 if(w?.identity?.interaction==='gpu-resident-connectivity'){
  const interaction=w.residentInteraction;
  if(!interaction||interaction.source!=='explicit-native-grip-readback'||interaction.runId!==w.runId||interaction.steps!==s.steps||interaction.route!=='kaminos.bounded-grip.resident-connectivity.v1'||!Array.isArray(interaction.components)||interaction.components.length!==m.points||interaction.components.some(v=>!Number.isInteger(v)||v<0||v>=m.points))errors.push('Current complete resident connectivity required');
  if(!Array.isArray(interaction?.fractureHistory)||interaction.fractureHistory.length!==m.bonds||interaction.fractureHistory.some((e,i)=>e.edge!==i||!Number.isFinite(e.threshold)||e.threshold<0||(s.bonds[i*4+2]===0?(!Number.isInteger(e.step)||e.step<0||e.step>s.steps):e.step!==null)))errors.push('Complete resident fracture history required');
 }
 const native=w?.surfaceObservation,route='kaminos.deformable-surface.resident-four-split.webgpu.v0';
 if(!native||native.source!=='native-webgpu-transport-compute-readback'||native.runId!==w?.runId||native.steps!==s?.steps||!Array.isArray(native.pieces)||native.pieces.length!==w?.pieces?.length)errors.push('Current native bounded surface observation required');
 else{const ids=new Set();for(const sample of native.pieces){const piece=w.pieces.find(p=>p.id===sample.pieceId);if(!piece||ids.has(sample.pieceId)||piece.surfaceRoute!==route||sample.route!==route||sample.runId!==w.runId||sample.step!==s.steps||!Array.isArray(sample.reference)||sample.reference.length!==piece.renderedPositions.length||sample.reference.some((v,i)=>v!==piece.renderedPositions[i]))errors.push('Native surface identity or picking reference changed');ids.add(sample.pieceId);}
  try{if(maximumBoundedSurfaceError(native.pieces)>3e-6)errors.push('Native surface differs from current picking geometry');}catch(e){errors.push(e.message);}
 }
 return errors;
}

export function maximumBoundedSurfaceError(samples){
 if(!Array.isArray(samples)||!samples.length)throw new Error('Complete native surface samples required');let maximum=0;
 for(const sample of samples){if(!Array.isArray(sample.gpu)||!sample.gpu.length||!Array.isArray(sample.reference)||sample.reference.length!==sample.gpu.length*3)throw new Error('Complete native surface and reference required');
  for(let i=0;i<sample.gpu.length;i++){const point=sample.gpu[i];if(!Array.isArray(point)||point.length!==3)throw new Error('Complete native surface coordinates required');for(let k=0;k<3;k++){const value=point[k],reference=sample.reference[i*3+k];if(!Number.isFinite(value)||!Number.isFinite(reference))throw new Error('Finite native surface coordinates required');maximum=Math.max(maximum,Math.abs(value-reference));}}
 }return maximum;
}
