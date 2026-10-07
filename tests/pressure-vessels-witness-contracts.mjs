import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../tools/pressure-vessels-witness.mjs',import.meta.url),'utf8');
const a=source.indexOf('function check('),b=source.indexOf('try{',a),code=source.slice(a,b);
const runtime={truthScene:'pressure_playground',solver_backend:'webgpu_compute',particleCount:36864,fixedVolumeReferenceParticleCount:36864,densityIterationsPerStep:3,particleVolumeScale:1,adaptiveDensity:false,packedDensity:true,uniformVolumeDensityKernel:true,densityCellRejection:true,artificialPressureMode:'off',effectiveRendererMode:'screen_space_surface',energyDiagnostics:{effectiveMode:'disabled'},pressurePlayground:{forcing:'resting-inventory-gravity-only',sourceRecirculation:false,gateOpen:false},stepCount:30};
const c={assert};vm.createContext(c);vm.runInContext(code,c);c.check({status:'running',runtime},'off');
for(const [key,value] of Object.entries({truthScene:'river_playground',solver_backend:'fallback',particleCount:24576,artificialPressureMode:'standard',effectiveRendererMode:'screen_space_refraction',densityIterationsPerStep:1}))assert.throws(()=>c.check({status:'running',runtime:{...runtime,[key]:value}},'off'));
for(const [key,value] of Object.entries({forcing:'prescribed-profile',sourceRecirculation:true,gateOpen:true}))assert.throws(()=>c.check({status:'running',runtime:{...runtime,pressurePlayground:{...runtime.pressurePlayground,[key]:value}}},'off'));
const ea=source.indexOf('function errors()'),eb=source.indexOf('function check(',ea);const tail=source.slice(source.lastIndexOf(" errors();assert.equal(git(root"),source.indexOf('}catch(e)'));
for(const event of [{method:'Runtime.exceptionThrown'},{method:'Runtime.consoleAPICalled',params:{type:'error'}}]){
 const report={status:'starting',events:[event]},context={assert,report,root:'owned',revision:'sha',git:(_r,cmd)=>cmd==='rev-parse'?'sha':''};vm.createContext(context);vm.runInContext(source.slice(ea,eb),context);assert.throws(()=>vm.runInContext(tail,context),/Browser error/);assert.notEqual(report.status,'done');
}
console.log('Pressure witness: effective route, gravity-only/gate identities and late-error disposition reject false closure');
