/** Copy the optional 16-word tail from each 40-word native IPBF state.
 * WebGPU permits one returned range over these bytes until unmap. */
export function readIPBFDampingRecordWords(readback,count){
  if(!Number.isSafeInteger(count)||count<1)throw Error('Invalid damping record count');
  const source=new Uint32Array(readback.getMappedRange());
  if(source.length!==count*40)throw Error('Missing complete IPBF storage record length');
  const words=new Array(count*16);
  for(let i=0;i<count;i++)for(let j=0;j<16;j++)words[i*16+j]=source[i*40+24+j];
  return words;
}

/** Decode complete same-copy damping-stage and committed-particle words.
 * The producer's native route/source identity is validated by the caller. */
export function decodeIPBFDampingEvidence(snapshot,particles,expected){
  const n=expected.particleCount,step=expected.stepCount;
  if(snapshot?.schema!=='kaminos.ipbf-damping-step.v1'||snapshot.packing!=='normal_alt_damped_context_vec4f_u32'||snapshot.recordWords!==16||snapshot.particleCount!==n||snapshot.stepCount!==step||step<1||snapshot.dampingEnabled!==expected.dampingEnabled)throw Error('Damping evidence identity mismatch');
  if(particles?.schema!=='kaminos.finger-fluid-particle-words.v1'||particles.recordWords!==16||particles.particleCount!==n||particles.stepCount!==step)throw Error('Committed particle identity mismatch');
  const floats=words=>{
    if(!Array.isArray(words)||words.length!==n*16||!words.every(w=>Number.isInteger(w)&&w>=0&&w<=0xffffffff))throw Error('Missing complete damping/particle words');
    const f=new Float32Array(new Uint32Array(words).buffer);
    if(!f.every(Number.isFinite))throw Error('Nonfinite damping/particle evidence');return f;
  };
  const f=floats(snapshot.words),p=floats(particles.words),records=[];
  const summary={count:n,active:0,applied:0,normalEnergy:0,alternateEnergy:0,dampedEnergy:0,committedEnergy:0,maximumCommittedDifference:0};
  const energy=v=>v.reduce((s,x)=>s+x*x,0);
  for(let i=0;i<n;i++){
    const o=i*16,normal=Array.from(f.slice(o,o+3)),alternative=Array.from(f.slice(o+4,o+7)),damped=Array.from(f.slice(o+8,o+11)),committed=Array.from(p.slice(o+8,o+11));
    if(f[o+12]!==Math.fround(expected.radius)||f[o+13]!==Math.fround(expected.beta))throw Error('Substituted damping radius/beta');
    const phase=f[o+3],separation=f[o+7],weight=f[o+11],softInertia=f[o+14],pressureHessianTrace=f[o+15];
    if(separation<0||weight<0||weight>1||softInertia<0||pressureHessianTrace<0)throw Error('Invalid damping record');
    const k=energy(normal),a=energy(alternative),d=energy(damped),v=energy(committed);
    // The captured weight is authoritative for GPU branch selection. Check
    // its resulting vector, allowing f32 dot/sqrt rounding near equal energies.
    const scale=Math.sqrt(Math.max(0,1-weight*(k-a)/Math.max(k,1e-300)));
    if(damped.some((x,j)=>Math.abs(x-normal[j]*scale)>4e-6*Math.max(1,Math.abs(normal[j]))))throw Error('Damping vector does not match captured energy blend');
    if(!snapshot.dampingEnabled&&weight!==0)throw Error('Disabled damping applied a correction');
    const committedDifference=Math.hypot(...committed.map((x,j)=>x-damped[j]));
    const r={index:i,phase,active:phase>=0,normal,alternative,damped,committed,separation,weight,softInertia,pressureHessianTrace,
      normalEnergy:k,alternateEnergy:a,dampedEnergy:d,committedEnergy:v,
      removableEnergyFraction:k>0?Math.max(0,(k-a)/k):0,removedEnergyFraction:k>0?(k-d)/k:0,committedDifference};
    records.push(r);
    if(r.active){summary.active++;if(weight>0)summary.applied++;summary.normalEnergy+=k;summary.alternateEnergy+=a;summary.dampedEnergy+=d;summary.committedEnergy+=v;summary.maximumCommittedDifference=Math.max(summary.maximumCommittedDifference,committedDifference);}
  }
  summary.removedEnergyFraction=summary.normalEnergy>0?(summary.normalEnergy-summary.dampedEnergy)/summary.normalEnergy:0;
  return {schema:'kaminos.ipbf-damping-decoded.v1',stepCount:step,records,summary,
    claimLimit:'Captured numerical-stage efficacy and later velocity difference; no visual-quality, physical damping calibration or performance verdict.'};
}
