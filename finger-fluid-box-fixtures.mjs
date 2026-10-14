// Finite fixture and support adapted from Paper Pilfer d46cf034; PBF composition.
export function validateFingerFluidDiagnosticPopulation(p,count=p?.particleCount) {
  if(p?.schema!=='kaminos.fluid-discriminator-population.v1')throw new TypeError('Diagnostic population schema mismatch');
  if(!Number.isSafeInteger(count)||count<1||p.particleCount!==count)throw new RangeError('Diagnostic population count mismatch');
  if(!(p.particleData instanceof Float32Array)||p.particleData.length!==count*16)throw new RangeError('Diagnostic population length mismatch');
  if(!p.particleData.every(Number.isFinite))throw new RangeError('Diagnostic population must be finite');
  if(!Number.isFinite(p.particleVolumeScale)||p.particleVolumeScale<=0)throw new RangeError('Diagnostic population volume must be positive');
  for(let i=0;i<count;i++)if(p.particleData[16*i+11]<.15)throw new RangeError('Finite diagnostic population must disable source recycling');
  return p;
}
/** Finite box: refinement changes spacing, sample volume, surface support and
 * collision size. PBF kernel support follows the volume-derived particle scale. */
// Allocation-free proposed geometry; the same descriptor drives allocation.
export function describeFingerFluidBoxReference({scene='block_drop',resolution=24,blockWidth=1,pressureRadius}={}) {
  if(!['block_drop','block_flop','dam_break'].includes(scene))throw new RangeError('Unknown box reference scene');
  if(!Number.isSafeInteger(resolution)||resolution<1)throw new RangeError('Samples per world unit must be a positive integer');
  if(scene==='block_flop'&&resolution%8!==0)throw new RangeError('Puddle thickness 1/8 requires samples per unit divisible by eight');
  if(!Number.isFinite(blockWidth)||blockWidth<=0||blockWidth>1.3)throw new RangeError('Block width must fit the 1.3-wide collision box');
  const across=blockWidth*resolution,blockSamples=Math.round(across);
  if(blockSamples<1||Math.abs(across-blockSamples)>1e-9)throw new RangeError('Block width × samples per unit must be a whole number; use width increments of 1/samples');
  if(pressureRadius!==undefined)throw new RangeError('Independent pressure radius unsupported in this PBF fixture');
  const spacing=1/resolution,volume=spacing**3,baseVolume=(64*Math.PI/315)*.185**3/24.3;
  const bounds={min:[-1.5,-1,-.65],max:[1.5,2,.65]};
  const regions=[{size:[blockSamples,blockSamples,blockSamples],origin:scene==='dam_break'?[-1.5,-1,-blockWidth/2]:[-blockWidth/2,.4,-blockWidth/2]}];
  if(scene==='block_flop')regions.push({size:[3*resolution,resolution/8,resolution],origin:[-1.5,-1,-.5]});
  const particleCount=regions.reduce((n,r)=>n+r.size.reduce((a,b)=>a*b,1),0);
  if(!Number.isSafeInteger(particleCount)||particleCount*16>0xffffffff)throw new RangeError('Box population exceeds typed-array capacity');
  const particleVolumeScale=volume/baseVolume,supportRadius=.185*Math.cbrt(particleVolumeScale);
  return {scene,resolution,blockWidth,blockSamples,spacing,particleCount,particleVolume:volume,particleVolumeScale,representedVolume:particleCount*volume,blockVolume:blockSamples**3*volume,puddleVolume:scene==='block_flop'?3/8:0,supportRadius,collisionRadius:.5*spacing,baseGlyphRadius:.046*Math.cbrt(particleVolumeScale),supportMode:'PBF_volume_scaled',bounds,regions};
}
export function createFingerFluidBoxReference(input={}) {
  const descriptor=describeFingerFluidBoxReference(input);
  const {scene,resolution,spacing,particleCount,particleVolume:volume,particleVolumeScale,bounds,regions}=descriptor;
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
  const population={schema:'kaminos.fluid-discriminator-population.v1',fixture:scene,refinement:resolution/24,particleCount,particleData:data,particleVolumeScale,representedVolume:particleCount*particleVolumeScale,worldVolume:particleCount*volume,source:'regular_lattice_finite_water_at_rest_no_recycling'};
  return {...descriptor,volumeUnits:'world_units_cubed',supportMode:'PBF_volume_scaled',box,population};
}

export function validateFingerFluidReferenceBox(box) {
  if(box?.schema!=='kaminos.fluid-reference-box.v1'||!Number.isFinite(box.collisionRadius)||box.collisionRadius<=0)throw new TypeError('Invalid reference box');
  if(box.collisions!==undefined&&typeof box.collisions!=='boolean')throw new TypeError('Reference box collisions must be Boolean');
  const {min,max}=box.bounds??{};
  if(!Array.isArray(min)||!Array.isArray(max)||min.length!==3||max.length!==3||min.some((v,k)=>!Number.isFinite(v)||!Number.isFinite(max[k])||max[k]-v<=2*box.collisionRadius))throw new RangeError('Invalid reference box bounds');
  const planes=[];for(let k=0;k<3;k++)for(const side of ['min','max']){const normal=[0,0,0];normal[k]=side==='min'?1:-1;planes.push({normal,offset:normal[k]*box.bounds[side][k]});}
  if(JSON.stringify(box.planes)!==JSON.stringify(planes))throw new RangeError('Reference box pressure planes must match collision bounds');
  return structuredClone(box);
}

export function fingerFluidReferenceBoxSupport(box) {
  const b=validateFingerFluidReferenceBox(box);
  if(b.collisions===false)return `const analyticObstacleSupportEnabled: bool = false;
fn floorHeight(p:vec3<f32>)->f32 {_=p;return -1e30;}
fn floorNormal(p:vec3<f32>)->vec3<f32> {_=p;return vec3<f32>(0,1,0);}
fn supportVelocityAt(p:vec3<f32>)->vec3<f32> {_=p;return vec3<f32>(0);}
fn supportSignedDistanceFrame(p:vec3<f32>,r:f32)->vec4<f32> {_=p;_=r;return vec4<f32>(0,1,0,1e30);}
fn resolveSupportPenetration(p:vec3<f32>,r:f32)->vec3<f32> {_=r;return p;}
fn resolveSupportVelocity(v:vec3<f32>,p:vec3<f32>,r:f32)->vec3<f32> {_=p;_=r;return v;}
fn supportContactFrame(p:vec3<f32>)->vec4<f32> {_=p;return vec4<f32>(0,1,0,0);}`;
  return `const analyticObstacleSupportEnabled: bool = false;
fn floorHeight(p:vec3<f32>)->f32 {_=p;return ${b.bounds.min[1]};}
fn floorNormal(p:vec3<f32>)->vec3<f32> {_=p;return vec3<f32>(0,1,0);}
fn supportVelocityAt(p:vec3<f32>)->vec3<f32> {_=p;return vec3<f32>(0);}
fn supportSignedDistanceFrame(p:vec3<f32>,r:f32)->vec4<f32> {return vec4<f32>(0,1,0,p.y-(${b.bounds.min[1]}+r));}
fn resolveSupportPenetration(p:vec3<f32>,r:f32)->vec3<f32> {return vec3<f32>(p.x,max(p.y,${b.bounds.min[1]}+r),p.z);}
fn resolveSupportVelocity(v:vec3<f32>,p:vec3<f32>,r:f32)->vec3<f32> {if(p.y<=${b.bounds.min[1]}+r+0.00001&&v.y<0){return vec3<f32>(v.x,0,v.z);}return v;}
fn supportContactFrame(p:vec3<f32>)->vec4<f32> {return vec4<f32>(0,1,0,1.0-smoothstep(0.0,${2*b.collisionRadius},max(0.0,p.y-(${b.bounds.min[1]}+${b.collisionRadius}))));}`;
}

// Same retained planar missing-kernel formula, composed over the six box faces.
// Product union is an overlap approximation at corners, not an exact integral.
export function boxBoundaryDensitySource(box){
 const b=validateFingerFluidReferenceBox(box);
 if(b.collisions===false)return `fn analytic_boundary_density_support(position:vec3<f32>,radiusScale:f32)->vec4<f32>{
 _=position;_=radiusScale;return vec4<f32>(0);
}`;
 return `fn analytic_boundary_density_support(position:vec3<f32>,radiusScale:f32)->vec4<f32>{
 let h=params.fluid.x*radiusScale;var fraction=0.0;var gradient=vec3<f32>(0);
 ${b.planes.map((p,i)=>`let n${i}=vec3<f32>(${p.normal.join(',')});let d${i}=max(0.0,dot(position,n${i})-(${p.offset})-${b.collisionRadius});let f${i}=boundary_missing_fraction(d${i},h);let g${i}=n${i}*boundary_missing_fraction_derivative(d${i},h);gradient=gradient*(1.0-f${i})+g${i}*(1.0-fraction);fraction=fraction+f${i}-fraction*f${i};`).join('\n')}
 let rho=max(params.fluid.y-1.0,0.0);return vec4<f32>(gradient*rho/max(params.fluid.y,.001),rho*fraction);
}`;
}
