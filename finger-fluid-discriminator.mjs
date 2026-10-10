/** Opt-in diagnosis of the assembled solver; never selected by ordinary routes. */
export function resolveFingerFluidDiagnosticDynamics(profile='assembled') {
  if(!['assembled','pressure_surface'].includes(profile))throw new RangeError('Unknown diagnostic dynamics profile: '+profile);
  return profile;
}
export function applyFingerFluidDiagnosticDynamics(source,profile='assembled') {
  resolveFingerFluidDiagnosticDynamics(profile);
  if(profile==='assembled')return source;
  const start=source.indexOf('  var neighborVelocity = vec3<f32>(0.0);');
  const end=source.indexOf('  let radius = params.fluid.x * 0.22;',start);
  if(start<0||end<0||!source.slice(start,end).includes('velocity = mix(velocity, neighborVelocity'))throw new Error('Reduced dynamics smoothing anchor missing');
  if(!source.includes('if (relaxedSpeed > solverMaximumSpeed)'))throw new Error('Reduced dynamics speed anchor missing');
  return (source.slice(0,start)+'  // Diagnostic core: paper velocity, with support response retained below.\n  restStates[index].z = 0.0;\n'+source.slice(end))
    .replaceAll('if (relaxedSpeed > solverMaximumSpeed)','if (false && relaxedSpeed > solverMaximumSpeed)')
    .replaceAll('if (speed > solverMaximumSpeed)','if (false && speed > solverMaximumSpeed)');
}
export function validateFingerFluidDiagnosticPopulation(p,count=p?.particleCount) {
  if(p?.schema!=='kaminos.fluid-discriminator-population.v1')throw new TypeError('Diagnostic population schema mismatch');
  if(!Number.isSafeInteger(count)||count<1||p.particleCount!==count)throw new RangeError('Diagnostic population count mismatch');
  if(!(p.particleData instanceof Float32Array)||p.particleData.length!==count*16)throw new RangeError('Diagnostic population length mismatch');
  if(!p.particleData.every(Number.isFinite))throw new RangeError('Diagnostic population must be finite');
  if(!Number.isFinite(p.particleVolumeScale)||p.particleVolumeScale<=0)throw new RangeError('Diagnostic population volume must be positive');
  for(let i=0;i<count;i++)if(p.particleData[16*i+11]<.15)throw new RangeError('Finite diagnostic population must disable source recycling');
  return p;
}
export function subdivideDiagnosticPopulation(base,refinement=1) {
  validateFingerFluidDiagnosticPopulation(base);
  if(![1,2].includes(refinement))throw new RangeError('This discriminator defines coarse and twofold spatial refinement');
  if(refinement===1)return base;
  const volume=(64*Math.PI/315)*.185**3/24.3*base.particleVolumeScale;
  const offset=Math.cbrt(volume)/4,data=new Float32Array(base.particleCount*8*16);
  for(let i=0;i<base.particleCount;i++)for(let j=0;j<8;j++){
    const o=(i*8+j)*16;data.set(base.particleData.subarray(i*16,i*16+16),o);
    for(let k=0;k<3;k++){const d=((j>>k)&1)?offset:-offset;data[o+k]+=d;data[o+4+k]+=d;}
  }
  return {...base,particleData:data,particleCount:base.particleCount*8,particleVolumeScale:base.particleVolumeScale/8,refinement};
}

/** Paper-inspired finite box controls. Dimensions stay fixed while resolution
 * changes spacing, sample volume, pressure/surface support and collision size. */
export function createFingerFluidBoxReference({scene='block_drop',resolution=24}={}) {
  if(!['block_drop','block_flop','dam_break'].includes(scene))throw new RangeError('Unknown box reference scene');
  if(!Number.isSafeInteger(resolution)||resolution<16||resolution%8!==0)throw new RangeError('Box resolution must be an integer multiple of eight, at least sixteen');
  const spacing=1/resolution,volume=spacing**3,baseVolume=(64*Math.PI/315)*.185**3/24.3;
  const bounds={min:[-1.5,-1,-.65],max:[1.5,2,.65]};
  const regions=[{size:[resolution,resolution,resolution],origin:scene==='dam_break'?[-1.5,-1,-.5]:[-.5,.4,-.5]}];
  if(scene==='block_flop')regions.push({size:[3*resolution,resolution/8,resolution],origin:[-1.5,-1,-.5]});
  const particleCount=regions.reduce((n,r)=>n+r.size.reduce((a,b)=>a*b,1),0);
  if(!Number.isSafeInteger(particleCount)||particleCount*16>0xffffffff)throw new RangeError('Box population exceeds typed-array capacity');
  const data=new Float32Array(particleCount*16);let i=0;
  for(const r of regions)for(let y=0;y<r.size[1];y++)for(let z=0;z<r.size[2];z++)for(let x=0;x<r.size[0];x++){
    const p=[x,y,z].map((v,k)=>r.origin[k]+(v+.5)*spacing);
    data.set([...p,1,...p,1,0,0,0,.3,0,0,0,24.3],16*i++);
  }
  const planes=[];
  for(let k=0;k<3;k++)for(const side of ['min','max']){
    const normal=[0,0,0];normal[k]=side==='min'?1:-1;
    planes.push({normal,offset:normal[k]*bounds[side][k]});
  }
  const box={schema:'kaminos.fluid-reference-box.v1',bounds,planes,collisionRadius:.5*spacing};
  const population={schema:'kaminos.fluid-discriminator-population.v1',fixture:scene,refinement:resolution/24,particleCount,particleData:data,particleVolumeScale:volume/baseVolume,source:'regular_lattice_finite_water_at_rest_no_recycling'};
  return {scene,resolution,spacing,particleCount,particleVolume:volume,representedVolume:particleCount*volume,pressureRadius:2*spacing,surfaceRadius:2*spacing,box,population};
}

export function validateFingerFluidReferenceBox(box) {
  if(box?.schema!=='kaminos.fluid-reference-box.v1'||!Number.isFinite(box.collisionRadius)||box.collisionRadius<=0)throw new TypeError('Invalid reference box');
  const {min,max}=box.bounds??{};
  if(!Array.isArray(min)||!Array.isArray(max)||min.length!==3||max.length!==3||min.some((v,k)=>!Number.isFinite(v)||!Number.isFinite(max[k])||max[k]-v<=2*box.collisionRadius))throw new RangeError('Invalid reference box bounds');
  const planes=[];for(let k=0;k<3;k++)for(const side of ['min','max']){const normal=[0,0,0];normal[k]=side==='min'?1:-1;planes.push({normal,offset:normal[k]*box.bounds[side][k]});}
  if(JSON.stringify(box.planes)!==JSON.stringify(planes))throw new RangeError('Reference box pressure planes must match collision bounds');
  return structuredClone(box);
}

export function fingerFluidReferenceBoxSupport(box) {
  const b=validateFingerFluidReferenceBox(box);
  return `const analyticObstacleSupportEnabled: bool = false;
fn floorHeight(p:vec3<f32>)->f32 {_=p;return ${b.bounds.min[1]};}
fn floorNormal(p:vec3<f32>)->vec3<f32> {_=p;return vec3<f32>(0,1,0);}
fn supportVelocityAt(p:vec3<f32>)->vec3<f32> {_=p;return vec3<f32>(0);}
fn supportSignedDistanceFrame(p:vec3<f32>,r:f32)->vec4<f32> {return vec4<f32>(0,1,0,p.y-(${b.bounds.min[1]}+r));}
fn resolveSupportPenetration(p:vec3<f32>,r:f32)->vec3<f32> {return vec3<f32>(p.x,max(p.y,${b.bounds.min[1]}+r),p.z);}
fn resolveSupportVelocity(v:vec3<f32>,p:vec3<f32>,r:f32)->vec3<f32> {if(p.y<=${b.bounds.min[1]}+r+0.00001&&v.y<0){return vec3<f32>(v.x,0,v.z);}return v;}
fn supportContactFrame(p:vec3<f32>)->vec4<f32> {return vec4<f32>(0,1,0,1.0-smoothstep(0.0,${2*b.collisionRadius},max(0.0,p.y-(${b.bounds.min[1]}+${b.collisionRadius}))));}`;
}
