import {readFileSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';

// The diagnostic uses local ESM imports and one external module script. Resolve
// that actual closure; unsupported/nonliteral imports fail source admission.
export function collectDiscriminatorSources(root,entrypoints) {
  const visited=new Map();root=resolve(root);
  function visit(name){
    const path=resolve(root,name),key=relative(root,path);
    if(key.startsWith('..')||!key)throw Error('Source dependency outside the experiment root: '+name);
    if(visited.has(key))return;
    const bytes=readFileSync(path),text=bytes.toString('utf8');
    visited.set(key,{name:key,sha256:createHash('sha256').update(bytes).digest('hex')});
    const dependencies=[];
    if(key.endsWith('.html')){
      for(const tag of text.matchAll(/<script\b[^>]*>/gi)){
        const src=tag[0].match(/\bsrc\s*=\s*(['"])(.*?)\1/i);
        if(!src)throw Error('Inline script is not admitted by the diagnostic source collector');
        dependencies.push(src[2]);
      }
    }else{
      for(const match of text.matchAll(/\b(?:import\s+(?:[\w*$ {},\n\r]+\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)(['"])([^'"]+)\1/g))dependencies.push(match[2]);
      for(const match of text.matchAll(/\bimport\s*\(([^)]*)\)/g)){
        const literal=match[1].trim().match(/^(['"])([^'"]+)\1$/);
        if(!literal)throw Error('Nonliteral dependency is not admitted: '+key);
        dependencies.push(literal[2]);
      }
    }
    for(const dependency of dependencies){
      if(dependency.startsWith('node:'))continue;
      if(!dependency.startsWith('./')&&!dependency.startsWith('../'))throw Error('Nonlocal dependency is not admitted: '+dependency);
      visit(relative(root,resolve(dirname(path),dependency)));
    }
  }
  for(const name of entrypoints)visit(name);
  return [...visited.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export async function verifyDiscriminatorServedSources(files,base,fetchSource=fetch){
  for(const f of files){
    const response=await fetchSource(new URL(f.name,base+'/'));
    if(!response.ok)throw Error('Served source missing: '+f.name);
    const digest=createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex');
    if(digest!==f.sha256)throw Error('Served source differs: '+f.name);
  }
}
export async function withDiscriminatorCleanup(action,cleanup,report){
  let primary;try{return await action();}catch(e){primary=e;throw e;}
  finally{try{await cleanup();}catch(e){(report.cleanupErrors??=[]).push(e.stack??String(e));if(!primary)throw e;}}
}
// Native Chrome154/Node25 CDP replay passed a 196608-word (2.16MB) JSON
// response and disconnected on the 1572864-word response. This is a transport
// batch size established by that replay, never a limit on captured state.
export const DISCRIMINATOR_TRANSFER_WORDS=196608;
export function assembleDiscriminatorChunks(metadata,chunks){
  const t=metadata?.transfer;
  if(t?.encoding!=='u32-le-json-chunks-v1'||typeof t.captureId!=='string'||!t.captureId||!Number.isSafeInteger(t.wordCount)||t.wordCount!==metadata.particleSnapshot?.particleCount*16||metadata.particleSnapshot?.recordWords!==16||!/^[a-f0-9]{64}$/.test(t.sha256))throw Error('Particle transfer header mismatch');
  const words=[];
  for(const c of chunks){
    if(c.captureId!==t.captureId||c.offset!==words.length||!Array.isArray(c.words)||!c.words.length||!c.words.every(w=>Number.isInteger(w)&&w>=0&&w<=0xffffffff)||words.length+c.words.length>t.wordCount)throw Error('Particle transfer chunk mismatch');
    for(const word of c.words)words.push(word);
  }
  if(words.length!==t.wordCount)throw Error('Particle transfer is incomplete');
  const bytes=Buffer.alloc(words.length*4);words.forEach((w,i)=>bytes.writeUInt32LE(w,i*4));
  if(createHash('sha256').update(bytes).digest('hex')!==t.sha256)throw Error('Particle transfer digest mismatch');
  return {...metadata,words};
}
export async function captureDiscriminatorState(evaluate,onPhase=()=>{}){
  onPhase('readback-header');
  const metadata=await evaluate(`(async()=>{
    const diagnostics=await discriminator.snapshot(),d=discriminator.debug(),raw=diagnostics.particleSnapshot;
    if(new Uint8Array(new Uint32Array([1]).buffer)[0]!==1)throw Error('Particle transfer requires little-endian captured words');
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint32Array(raw.words).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
    const captureId=crypto.randomUUID();globalThis.__discriminatorReadback={captureId,words:raw.words};
    return {adapter:d.adapterInfo,box:d.diagnosticBox,dynamics:d.diagnosticDynamics,pressure:d.ipbfSettings,surface:d.cohesionSettings,step:d.stepCount,particleSnapshot:{...raw,words:undefined},diagnostics:{...diagnostics,particleSnapshot:undefined},stages:{density:d.densityIterationCount,surface:d.surfaceForcePassCount,vorticity:d.vorticityPassCount},errors:discriminator.errors,transfer:{encoding:'u32-le-json-chunks-v1',captureId,wordCount:raw.words.length,sha256}};
  })()`);
  const chunks=[],wordCount=metadata?.transfer?.wordCount;
  if(!Number.isSafeInteger(wordCount)||wordCount<=0||wordCount!==metadata.particleSnapshot?.particleCount*16)throw Error('Particle transfer header mismatch');
  for(let offset=0;offset<wordCount;offset+=DISCRIMINATOR_TRANSFER_WORDS){
    onPhase('readback-words-'+offset);
    chunks.push(await evaluate(`(()=>{const held=globalThis.__discriminatorReadback;return {captureId:held.captureId,offset:${offset},words:held.words.slice(${offset},${Math.min(wordCount,offset+DISCRIMINATOR_TRANSFER_WORDS)})};})()`));
  }
  return assembleDiscriminatorChunks(metadata,chunks);
}
export function validateDiscriminatorState(actual,request) {
  if(actual?.adapter?.vendor!=='apple'||actual.adapter.isFallbackAdapter!==false)throw Error('Unverified native backend');
  const reduced=request.arm!=='assembled',d=actual.dynamics;
  if(d?.effective!==(reduced?'pressure_surface':'assembled')||d.neighborSmoothing!==!reduced||d.vorticityConfinement!==!reduced||d.speedClipping!==!reduced)throw Error('Effective dynamics mismatch');
  if(actual.step!==request.step)throw Error('Stale step');
  const raw=actual.particleSnapshot,diagnostics=actual.diagnostics;
  if(raw?.schema!=='kaminos.finger-fluid-particle-words.v1'||raw.packing!=='position_predicted_velocity_delta_vec4x4_f32_bits'||raw.particleCount!==request.particleCount||raw.recordWords!==16||raw.stepCount!==request.step||raw.pressureSolver!=='ipbf'||raw.boundaryPressureContract!==(request.boundaryContract??'ipbf-collision-projection-only-v0')||diagnostics?.stepCount!==request.step||diagnostics.readbackMode!=='explicit_full_particle_gpu_diagnostics_v1')throw Error('Raw readback identity mismatch');
  const inputs=diagnostics.pressureControlInputs;
  if(inputs?.packing!=='ipbf_vec4f_and_finger_fluid_params_v0_u32_bits'||inputs.pressureWords?.length!==4||inputs.simulationWords?.length!==56)throw Error('Missing effective GPU timestep/input bytes');
  const uniform=new Float32Array(new Uint32Array(inputs.simulationWords).buffer);
  if(uniform[0]!==Math.fround(request.dt))throw Error('Effective GPU timestep mismatch');
  const near=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<=1e-6*Math.max(Math.abs(b),1e-8);
  if(d.population?.particleCount!==request.particleCount||!near(d.population.particleVolume,request.volume)||!near(actual.pressure?.radius,request.radius)||!near(actual.surface?.neighborhoodRadius,request.surfaceRadius)||!near(actual.surface?.coefficient,request.gamma))throw Error('Effective configuration mismatch');
  if(!Array.isArray(actual.words)||actual.words.length!==request.particleCount*16||!actual.words.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff))throw Error('Missing complete particle state');
  const values=new Float32Array(new Uint32Array(actual.words).buffer);
  if(!values.every(Number.isFinite))throw Error('Particle state is not finite');
  for(let i=0;i<request.particleCount;i++)if(values[i*16+11]<.15)throw Error('Inactive/recycling source in finite pour');
  return values;
}
export function validateBoxReferenceState(actual,fixture,step,{radiusRatio=2,passes=2,gamma=0,beta=.0113,dt=1/240}={}){
  if(JSON.stringify(actual?.box)!==JSON.stringify(fixture.box))throw Error('Effective reference box mismatch');
  const population=actual?.dynamics?.population;
  if(population?.fixture!==fixture.scene||population.source!==fixture.population.source||population.refinement!==fixture.population.refinement)throw Error('Effective box population identity mismatch');
  const values=validateDiscriminatorState(actual,{arm:'reduced',particleCount:fixture.particleCount,volume:fixture.particleVolume,radius:radiusRatio*fixture.spacing,surfaceRadius:fixture.surfaceRadius,gamma,step,dt,boundaryContract:'ipbf-cubic-tangent-plane-density-v1'});
  const inputs=actual.diagnostics.pressureControlInputs,u=new Float32Array(new Uint32Array(inputs.simulationWords).buffer),p=new Float32Array(new Uint32Array(inputs.pressureWords).buffer);
  if(actual.pressure.boundaryPressure!=='tangent_plane'||p[0]!==Math.fround(radiusRatio*fixture.spacing)||p[1]!==Math.fround(beta)||u[29]!==Math.fround(gamma)||new Uint32Array(inputs.simulationWords)[1]!==fixture.particleCount)throw Error('Effective box pressure inputs mismatch');
  for(let k=0;k<3;k++)if(u[8+k]!==Math.fround(fixture.box.bounds.min[k])||u[12+k]!==Math.fround(fixture.box.bounds.max[k]))throw Error('GPU collision box bounds mismatch');
  if(actual.stages.density!==passes*step||actual.stages.surface!==3*step||actual.stages.vorticity!==0||actual.errors.length)throw Error('Box stage execution or GPU errors mismatch');
  return values;
}
export function validateBoxReferenceBoot(boot,config){
  const {fixture,dt,solver}=config,actual=boot?.fixture;
  if(!actual||actual.scene!==fixture.scene||actual.resolution!==fixture.resolution||boot.dt!==dt||JSON.stringify(actual.box)!==JSON.stringify(fixture.box))throw Error('Reference box boot scene mismatch');
  for(const field of ['spacing','particleCount','particleVolume','representedVolume','pressureRadius','surfaceRadius'])if(actual[field]!==fixture[field])throw Error('Reference box boot sampling mismatch: '+field);
  for(const field of ['pressureSolver','diagnosticDynamics','densityIterations','capillaryStrength','ipbfDampingBeta','ipbfPressureRadiusScale','akinciSupportRadius'])if(boot.config?.[field]!==solver[field])throw Error('Reference box boot configuration mismatch: '+field);
  const population=boot.config?.diagnosticPopulation;
  if(population?.fixture!==fixture.scene||population.source!==fixture.population.source||population.refinement!==fixture.population.refinement)throw Error('Reference box boot population identity mismatch');
}
export function summarizeParticleState(values) {
  const n=values.length/16,center=[0,0,0],velocity=[0,0,0],variance=[0,0,0],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  let energy=0;
  for(let i=0;i<n;i++)for(let k=0;k<3;k++){const p=values[i*16+k],v=values[i*16+8+k];center[k]+=p/n;velocity[k]+=v/n;energy+=v*v/n;min[k]=Math.min(min[k],p);max[k]=Math.max(max[k],p);}
  for(let i=0;i<n;i++)for(let k=0;k<3;k++)variance[k]+=(values[i*16+k]-center[k])**2/n;
  return {count:n,center,meanVelocity:velocity,variance,bounds:{min,max},rmsSpeed:Math.sqrt(energy),shapeRatio:Math.sqrt(Math.max(...variance)/Math.min(...variance))};
}
