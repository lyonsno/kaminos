/** Execution boundary: GPU representation, not an empirically chosen stability band. */
export function validateFluidTimeStep(value) {
 const gpu=Math.fround(value);
 if(!Number.isFinite(value)||value<=0||!Number.isFinite(gpu)||gpu<=0)
  throw new RangeError('Physics timestep must be positive, finite and representable in WebGPU f32');
 return value;
}
