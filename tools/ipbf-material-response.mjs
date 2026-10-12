/** Offline calibration station. No code in the interactive step imports this. */
import {cubicSplineKernel, dampIPBFVelocity} from '../finger-fluid-ipbf-reference.mjs';
import {evaluateFingerFluidCohesionPairWeight, evaluateFingerFluidCohesionAcceleration} from '../finger-fluid-cohesion.mjs';

const positive=(x,name)=>{if(!Number.isFinite(x)||x<=0)throw new RangeError(`${name} must be finite and positive`);};
const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw new TypeError(`${name} must be a finite 3D vector`);};
const norm=v=>Math.hypot(...v);

export function validateNativeCases(cases) {
  if(!Array.isArray(cases)||!cases.length)throw new Error('Native cases must be nonempty');
  for(const c of cases){
    if(typeof c?.name!=='string'||!c.name.trim())throw new Error('Native case name missing');
    if(!Number.isFinite(c.dt)||c.dt<=0||!Number.isFinite(Math.fround(c.dt))||Math.fround(c.dt)<=0)throw new Error('Native timestep must be positive and representable in f32');
    if(!Number.isFinite(c.strength)||c.strength<0||!Number.isFinite(Math.fround(c.strength))||!Number.isFinite(Math.fround(Math.fround(c.strength)*Math.fround(9.2))))throw new Error('Native strength must be nonnegative and representable in the GPU acceleration');
  }
  return cases;
}

export function nativeModuleURL(baseURL) {
  const base=new URL(baseURL);
  if(!['http:','https:'].includes(base.protocol)||base.search||base.hash)throw new Error('Native source base must be an HTTP(S) directory without query or fragment');
  if(!base.pathname.endsWith('/'))base.pathname+='/';
  return new URL('finger-fluid-webgpu-core.js',base).href;
}

/** Current recovered force on an explicit, unsupported cluster. Its pair
 * weights are reciprocal; its per-particle normalization need not be. */
export function cohesionCluster({positions,volumeScales,surfaceFactors,strength,gravity,kernelRadius}) {
  positive(kernelRadius,'kernelRadius');positive(gravity,'gravity');
  if(!Array.isArray(positions)||!positions.length)throw new TypeError('positions missing');
  positions.forEach(p=>vector(p,'position'));
  for(const [name,values] of Object.entries({volumeScales,surfaceFactors})){
    if(!Array.isArray(values)||values.length!==positions.length||!values.every(Number.isFinite))throw new TypeError(`${name} must match all positions`);
  }
  volumeScales.forEach(v=>positive(v,'volume scale'));
  if(surfaceFactors.some(v=>v<0||v>1))throw new RangeError('surface factors outside [0,1]');
  const weights=positions.map(()=>0),directions=positions.map(()=>[0,0,0]);
  for(let i=0;i<positions.length;i++)for(let j=0;j<positions.length;j++)if(i!==j){
    const offset=positions[j].map((x,k)=>x-positions[i][k]),r=norm(offset);
    if(r<=.00001||r>=kernelRadius)continue;
    const w=volumeScales[j]*evaluateFingerFluidCohesionPairWeight({q:r/kernelRadius,surfaceFactor:surfaceFactors[i],neighborSurface:surfaceFactors[j],densityRatio:.2,neighborDensityRatio:.2,cohesionModel:'ipbf_free_surface'});
    weights[i]+=w;for(let k=0;k<3;k++)directions[i][k]+=offset[k]/r*w;
  }
  const accelerations=directions.map((weightedDirection,i)=>evaluateFingerFluidCohesionAcceleration({weightedDirection,totalWeight:weights[i],strength,gravity,activity:1,cohesionModel:'ipbf_free_surface'}));
  const totalVolume=volumeScales.reduce((a,b)=>a+b,0);
  const centerOfMassAcceleration=[0,1,2].map(k=>accelerations.reduce((a,v,i)=>a+v[k]*volumeScales[i],0)/totalVolume);
  return {positions,volumeScales,surfaceFactors,weights,accelerations,centerOfMassAcceleration,
    internalMomentumTarget:{expected:[0,0,0],observed:centerOfMassAcceleration,passed:norm(centerOfMassAcceleration)<=64*Number.EPSILON*Math.max(1,gravity*strength)}};
}

/** Infinite cubic lattice at the origin: enumerate the complete compact support.
 * This is reference-volume spacing, not measured live nearest-neighbor distance. */
export function latticeSampling({particleVolume,radius}) {
  positive(particleVolume,'particleVolume');positive(radius,'radius');
  const spacing=Math.cbrt(particleVolume),extent=Math.ceil(radius/spacing),density={bulk:0,halfspace:0,sheet:0,line:0};
  let sampleCount=0;
  for(let x=-extent;x<=extent;x++)for(let y=-extent;y<=extent;y++)for(let z=-extent;z<=extent;z++){
    const offset=[x*spacing,y*spacing,z*spacing];if(norm(offset)>=radius)continue;
    sampleCount++;const contribution=particleVolume*cubicSplineKernel(offset,radius).value;
    density.bulk+=contribution;if(y<=0)density.halfspace+=contribution;if(y===0)density.sheet+=contribution;if(y===0&&z===0)density.line+=contribution;
  }
  return {spacing,radius,spanInSpacings:radius/spacing,sampleCount,densityRatios:density,selfDensityRatio:particleVolume*cubicSplineKernel([0,0,0],radius).value,
    claimLimit:'Complete ideal-lattice kernel quadrature, excluding solid support. Missing free-surface neighbors do not imply bulk compression.'};
}

export function materialResponse(config) {
  if(config?.pressureSolver!=='ipbf'||config?.cohesionModel!=='ipbf_free_surface')throw new RangeError('Calibration requires explicit IPBF/recovered cohesion route');
  for(const key of ['kernelRadius','particleVolume','pressureRadius','beta','gravity','dt'])positive(config[key],key);
  if(!Number.isSafeInteger(config.passes)||config.passes<1)throw new RangeError('passes must be a positive safe integer');
  const {kernelRadius:h,particleVolume:V,pressureRadius:R,beta,dt,gravity:g,cohesion:strength}=config;
  const sampling=latticeSampling({particleVolume:V,radius:R}),d=sampling.spacing;
  const cluster=cohesionCluster({positions:[[0,0,0],[.6*h,0,0],[.95*h,0,0]],volumeScales:[1,1,1],surfaceFactors:[1,1,1],strength,gravity:g,kernelRadius:h});
  const equivalentPairs=cohesionCluster({positions:[[0,0,0],[.6*h,0,0]],volumeScales:[1,1],surfaceFactors:[1,1],strength,gravity:g,kernelRadius:h});
  const distances=[0,.25,.5,1,2].map(f=>({fractionOfThreshold:f,velocity:dampIPBFVelocity({velocity:[3,0,0],alternativeVelocity:[1,0,0],positionDifference:f*beta*R,supportRadius:R,beta})}));
  return {schema:'kaminos.ipbf-material-response.v1',route:'cpu-equation-audit',effective:config,
    sampling,dimensionless:{pressureSpanInSpacings:R/d,cohesionSupportInSpacings:h/d,dampingThresholdInSpacings:beta*R/d,gravityStep:g*dt*dt/d,cohesionStep:strength*g*dt*dt/d},
    damping:{threshold:beta*R,units:'world distance',samples:distances,claimLimit:'Energy-selective numerical damping, not kinematic viscosity; beta*R invariance does not establish timestep-invariant whole-solver damping.'},
    cohesion:{units:'gravity-relative acceleration gain',equalPair:equivalentPairs,asymmetricCluster:cluster,
      claimLimit:'Actual recovered free-flight equation. Support activity, density classification, pressure and all other stages are excluded.'},
    calibration:{physicalSurfaceTension:'unestablished',physicalViscosity:'unestablished',internalMomentumTarget:cluster.internalMomentumTarget.passed?'pass':'fail',
      conclusion:cluster.internalMomentumTarget.passed?'This fixture does not exclude physical calibration.':'Per-particle normalization produces internal center-of-mass acceleration. A scalar calibration of this law cannot repair the conservation failure.'},
    claimLimit:'Isolated numerical/material response. No physical water default, live basin attribution, performance gain or solver adoption.'};
}

export function validateNativeCohesion(native,expectedCases) {
  validateNativeCases(expectedCases);
  if(native?.route!=='actual-factory-ipbf-cohesion'||native?.adapter?.vendor!=='apple'||native?.adapter?.fallback!==false)throw new Error('Wrong/fallback native route');
  if(native?.effective?.pressureSolver!=='ipbf'||native?.effective?.cohesionModel!=='ipbf_free_surface')throw new Error('Wrong effective force model');
  if(!Array.isArray(native.cases)||native.cases.length!==expectedCases.length)throw new Error('Missing/partial native cases');
  for(let k=0;k<expectedCases.length;k++){
    const actual=native.cases[k],expected=expectedCases[k];
    if(actual.name!==expected.name||actual.dt!==expected.dt||actual.strength!==expected.strength)throw new Error('Native case/configuration mismatch');
    if(actual.input?.length!==48||actual.output?.length!==48||!actual.input.every(Number.isFinite)||!actual.output.every(Number.isFinite))throw new Error('Missing/nonfinite native vectors');
    if(actual.simulationWords?.length!==56||!actual.simulationWords.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff))throw new Error('Missing/invalid effective GPU packet');
    const words=new Uint32Array(actual.simulationWords),values=new Float32Array(words.buffer);
    if(words[1]!==3||values[0]!==Math.fround(expected.dt)||values[16]!==Math.fround(.185)||values[20]!==Math.fround(-9.2)||values[29]!==Math.fround(expected.strength)||values[26]!==0)throw new Error('Stale effective GPU configuration');
    if(actual.restInput?.length!==12||!actual.restInput.every(x=>x===0))throw new Error('Native cluster is not unsupported');
    if(actual.topologyInput?.length!==108||!actual.topologyInput.every((x,i)=>x===(i%36===32?1:0)))throw new Error('Native topology/volume mismatch');
    const input=new Float32Array(actual.input),output=new Float32Array(actual.output);
    for(let i=0;i<3;i++){
      const position=[-1.2+[0,.6,.95][i]*Math.fround(.185),1.5,.6];
      const expectedInput=new Float32Array([...position,1,...position,1,0,0,0,.08,0,0,0,4.86]);
      for(let word=0;word<16;word++)if(input[i*16+word]!==expectedInput[word])throw new Error('Native fixture input mismatch');
    }
    const positions=[0,1,2].map(i=>Array.from(input.slice(i*16+4,i*16+7)));
    // Deliberately frozen free-flight input. No classification/support pass.
    const oracle=cohesionCluster({positions,volumeScales:[1,1,1],surfaceFactors:[1,1,1],strength:Math.fround(actual.strength),gravity:Math.fround(9.2),kernelRadius:Math.fround(.185)});
    const observed=[0,1,2].map(i=>[0,1,2].map(a=>(output[i*16+12+a]-input[i*16+12+a])/Math.fround(actual.dt)));
    let maxError=0;
    for(let i=0;i<3;i++)for(let axis=0;axis<3;axis++)maxError=Math.max(maxError,Math.abs(observed[i][axis]-oracle.accelerations[i][axis]));
    if(!observed.every(v=>v.every(Number.isFinite))||!Number.isFinite(maxError))throw new Error('Nonfinite derived native response');
    if(maxError>3e-5*Math.max(1,actual.strength))throw new Error('Native attraction differs from independent equation response');
    for(let i=0;i<3;i++)for(const word of [0,1,2,3,4,5,6,7,8,9,10,11,15])if(output[i*16+word]!==input[i*16+word])throw new Error('Native stage changed immutable input/metadata');
    actual.oracle=oracle;actual.observedAccelerations=observed;actual.maxAccelerationError=maxError;
    actual.centerOfMassAcceleration=[0,1,2].map(a=>observed.reduce((s,v)=>s+v[a],0)/3);
  }
  return native;
}
