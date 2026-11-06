// kaminos-test: node
import assert from 'node:assert/strict';
import {defaultLocalLiquidSetup,normalizeLocalLiquidSetup,normalizeLocalLiquidEmitter,LOCAL_LIQUID_EMITTER_SCHEMA} from '../local-liquid-setup.mjs';
import {authoredMlsSetup,authoredMlsInlets,authoredMlsCellSize} from '../authored-mls-water.mjs';
import {mlsConfig,createMlsClock} from '../mls-juice-contract.mjs';
const source={schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'continuous',baseRadius:.075,strength:1.5,rate:1200,volumeRate:Math.PI*.075**2*1.5,aimAt:'aim-point'};
assert.equal(normalizeLocalLiquidEmitter(source).aimAt,'aim-point','Aim target must survive ordinary source normalization/save');
const quality={cellSize:.025,timeStepSeconds:1/480,viscosity:.03,stiffness:75,stepSubsteps:8,maxSubstepsPerBatch:32,timePolicy:'complete'};
const setup=normalizeLocalLiquidSetup({...defaultLocalLiquidSetup(),...quality,waterSampling:{spacing:.02,container:null,worldBounds:{min:[-1,0,-1],max:[1,2,1]}}});
for(const [key,value] of Object.entries(quality))assert.equal(setup[key],value,`Saved simulation retains ${key}`);
const record={id:'jet',type:'local-liquid-emitter',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:source};
assert.equal(authoredMlsCellSize([record],setup),.025,'Continuous jets use the requested simulation resolution');
const compiled=authoredMlsSetup([record],setup),config=mlsConfig(compiled.solver);
for(const [key,expected] of [['cell',.025],['dt',1/480],['viscosity',.03],['stiffness',75],['maxSubstepsPerBatch',32],['maxBacklogSeconds',Infinity]])assert.equal(config[key],expected,`Runtime honors ${key}`);
const fine=authoredMlsInlets([record],0,1,.025).emitters[0],coarse=authoredMlsInlets([record],0,1,.05).emitters[0];
assert.equal(fine.source_flux_particles_per_second/coarse.source_flux_particles_per_second,8,'Refining resolution preserves volume flow by increasing births');
const clock=createMlsClock(config.dt,{maxSubstepsPerBatch:32,maxBacklogSeconds:config.maxBacklogSeconds});clock.advanceSteps(8);assert.equal(clock.read().simulatedSeconds,8/480);
for(const patch of [{cellSize:0},{timeStepSeconds:-1},{viscosity:-1},{stiffness:-1},{stepSubsteps:1.5},{timePolicy:'pretend'}])assert.throws(()=>normalizeLocalLiquidSetup({...defaultLocalLiquidSetup(),...patch}));
assert.equal(mlsConfig().dt,1/240,'Old scenes keep their physical timestep');
console.log('Water quality and aim target contracts pass');

const scaled={position:[0,0,0],rotation:[0,0,0],scale:[2,2,2]};
const coupled=normalizeLocalLiquidEmitter({...source,flowMode:'speed'},scaled);assert.equal(coupled.volumeRate,Math.PI*.15**2*1.5);
const conserved=normalizeLocalLiquidEmitter({...source,baseRadius:.15,flowMode:'flow'},scaled);assert.equal(conserved.strength,source.volumeRate/(Math.PI*.3**2));
assert.doesNotThrow(()=>normalizeLocalLiquidEmitter({...source,strength:5,baseRadius:.3}),'Physical exploration has no legacy arbitrary speed/aperture ceiling');
const {waterAimRotation,resolveWaterAim,waterBallisticPreview}=await import('../water-aim.mjs');
const {Euler,Vector3}=await import('../lib/three.core.js');
for(const position of [[1,0,0],[0,1,0],[0,0,-1],[.2,-.8,.5]]){const rotation=waterAimRotation([0,0,0],position),forward=new Vector3(0,0,1).applyEuler(new Euler(...rotation)),expected=new Vector3(...position).normalize();assert(forward.distanceTo(expected)<1e-7);}
assert.equal(waterAimRotation([0,0,0],[0,0,0]),null);assert.equal(resolveWaterAim(record,[]).resolved,false);
const arc=waterBallisticPreview([0,1,0],[0,0,0],2,.25);assert.equal(arc.at(-1)[1],1-4.905*.25**2);assert.equal(arc.at(-1)[2],.5);
