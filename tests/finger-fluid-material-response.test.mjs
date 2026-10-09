import test from 'node:test';
import assert from 'node:assert/strict';
import {cohesionCluster,latticeSampling,materialResponse,validateNativeCohesion} from '../tools/ipbf-material-response.mjs';

const config={pressureSolver:'ipbf',cohesionModel:'ipbf_free_surface',kernelRadius:.185,particleVolume:(64*Math.PI/315)*.185**3/24.3,pressureRadius:.151,beta:.0113,gravity:9.2,dt:1/60,passes:2,cohesion:9.35};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-11,`${a} != ${b}`);

test('complete lattice kernel sums preserve density under geometric scaling',()=>{
  const a=latticeSampling({particleVolume:config.particleVolume,radius:.151});
  const b=latticeSampling({particleVolume:config.particleVolume*8,radius:.302});
  assert.equal(a.sampleCount,b.sampleCount);
  close(a.densityRatios.bulk,b.densityRatios.bulk);close(a.spanInSpacings,b.spanInSpacings);
  assert.ok(a.densityRatios.line<a.densityRatios.sheet&&a.densityRatios.sheet<a.densityRatios.halfspace);
  assert.equal(latticeSampling({particleVolume:1,radius:.5}).sampleCount,1);
});

test('closed asymmetric cluster exposes momentum failure hidden by a reciprocal-pair test',()=>{
  const args={kernelRadius:1,strength:1,gravity:1};
  const pair=cohesionCluster({...args,positions:[[0,0,0],[.6,0,0]],volumeScales:[1,1],surfaceFactors:[1,1]});
  close(pair.centerOfMassAcceleration[0],0);assert.equal(pair.internalMomentumTarget.passed,true);
  const c=cohesionCluster({...args,positions:[[0,0,0],[.6,0,0],[.95,0,0]],volumeScales:[1,1,1],surfaceFactors:[1,1,1]});
  // Independent polynomial values: q=.95 outer band, q=.35 inner band.
  const outer=1-(3*(13/18)**2-2*(13/18)**3),inner=3*(7/30)**2-2*(7/30)**3;
  const expected=(1+(-1+inner)/(1+inner)-outer-inner)/3;
  close(c.centerOfMassAcceleration[0],expected);assert.equal(c.internalMomentumTarget.passed,false);
});

test('audit cannot promote a failed mechanical target into physical calibration',()=>{
  const a=materialResponse(config),b=materialResponse({...config,dt:config.dt/2});
  assert.equal(a.calibration.internalMomentumTarget,'fail');
  assert.equal(a.calibration.physicalSurfaceTension,'unestablished');
  close(a.dimensionless.cohesionStep/4,b.dimensionless.cohesionStep);
  close(a.cohesion.asymmetricCluster.accelerations[0][0],b.cohesion.asymmetricCluster.accelerations[0][0]);
  close(a.damping.samples[2].velocity[0],Math.sqrt(5));
  assert.throws(()=>materialResponse({...config,pressureSolver:'pbf'}),/route/);
  assert.throws(()=>materialResponse({...config,particleVolume:0}),/positive/);
});

test('native evidence refuses fallback, wrong model, partial and stale configuration',()=>{
  const cases=[{name:'gain1',strength:1,dt:.01}];
  assert.throws(()=>validateNativeCohesion({route:'cpu-equation-audit'},cases),/native route/);
  const base={route:'actual-factory-ipbf-cohesion',adapter:{vendor:'apple',fallback:false},effective:{pressureSolver:'ipbf',cohesionModel:'ipbf_free_surface'},cases:[]};
  assert.throws(()=>validateNativeCohesion(base,cases),/partial/);
  assert.throws(()=>validateNativeCohesion({...base,effective:{pressureSolver:'pbf'}},cases),/model/);
  assert.throws(()=>validateNativeCohesion({...base,cases:[{name:'gain1',strength:60,dt:.01}]},cases),/configuration/);
  assert.throws(()=>validateNativeCohesion({...base,cases:[{...cases[0],input:[],output:[]}]},cases),/vectors/);
});

test('native evidence checks effective GPU words and full unsupported fixture inputs',()=>{
  const spec={name:'zero',dt:.01,strength:0};
  const input=new Float32Array(48),topology=new Float32Array(108),words=new Uint32Array(56),f32=new Float32Array(words.buffer);
  f32[0]=spec.dt;words[1]=3;f32[16]=.185;f32[20]=-9.2;f32[29]=0;
  for(let i=0;i<3;i++){
    const p=[-1.2+[0,.6,.95][i]*Math.fround(.185),1.5,.6];
    input.set([...p,1,...p,1,0,0,0,.08,0,0,0,4.86],16*i);topology[i*36+32]=1;
  }
  const row={...spec,input:Array.from(input),output:Array.from(input),simulationWords:Array.from(words),restInput:Array(12).fill(0),topologyInput:Array.from(topology)};
  const make=change=>({route:'actual-factory-ipbf-cohesion',adapter:{vendor:'apple',fallback:false},effective:{pressureSolver:'ipbf',cohesionModel:'ipbf_free_surface'},cases:[{...structuredClone(row),...change}]});
  assert.doesNotThrow(()=>validateNativeCohesion(make({}),[spec]));
  const stale=words.slice();new Float32Array(stale.buffer)[0]=.02;
  assert.throws(()=>validateNativeCohesion(make({simulationWords:Array.from(stale)}),[spec]),/effective GPU/);
  assert.throws(()=>validateNativeCohesion(make({simulationWords:[]}),[spec]),/GPU/);
  assert.throws(()=>validateNativeCohesion(make({restInput:Array(12).fill(1)}),[spec]),/unsupported/);
  assert.throws(()=>validateNativeCohesion(make({topologyInput:Array(108).fill(0)}),[spec]),/topology/);
  const wrong=input.slice();wrong[4]+=.01;
  assert.throws(()=>validateNativeCohesion(make({input:Array.from(wrong),output:Array.from(wrong)}),[spec]),/fixture input/);
});
