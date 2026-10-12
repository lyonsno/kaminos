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
 return errors;
}
