// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {captureFingerFluidParticleWordsForWitness,KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT} from '../finger-fluid-webgpu-core.js';
const source=readFileSync(process.env.WATER_READBACK_SOURCE??new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
const begin=source.indexOf('  async function requestParticleState() {');
assert.ok(begin>=0,'Particle inspection must exist at tick zero without general fire-contact diagnostics');
const end=source.indexOf('  async function requestDiagnostics(',begin);
const words=new Uint32Array(1024*16);words[0]=0x7fc01234;words[1]=0x3f800000;
let copied=false,submits=0,failMap=false;
const buffer={mapState:'unmapped',async mapAsync(){if(failMap)throw Error('map rejected');this.mapState='mapped';},getMappedRange(){assert.ok(copied);return words.buffer;},unmap(){this.mapState='unmapped';}};
const context={Error,Float32Array,GPUMapMode:{READ:1},diagnosticsPending:false,runtimeLifecycle:{stopped:false},stepCount:0,
 device:{createCommandEncoder:()=>({copyBufferToBuffer:(a,ao,b,bo,n)=>{assert.equal(a,context.particleBuffer);assert.equal(b,buffer);assert.equal(n,words.byteLength);copied=true;},finish:()=>({})}),queue:{submit:()=>submits++}},particleBuffer:{},diagnosticsBuffer:buffer,particleData:{byteLength:words.byteLength},safeParticleCount:1024,safePressureSolver:'pbf',pressureBoundary:{boundaryPressureContract:KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT},captureFingerFluidParticleWordsForWitness};
vm.createContext(context);vm.runInContext(source.slice(begin,end),context);
const result=await context.requestParticleState();assert.equal(result.stepCount,0);assert.equal(result.words.length,words.length);assert.equal(result.words[0],words[0],'Raw NaN bits must remain intact, not become filtered evidence');assert.equal(result.words[1],words[1]);assert.equal(context.diagnosticsPending,false);assert.equal(buffer.mapState,'unmapped');assert.equal(submits,1);
context.diagnosticsPending=true;await assert.rejects(context.requestParticleState(),/busy/);context.diagnosticsPending=false;
context.runtimeLifecycle.stopped=true;await assert.rejects(context.requestParticleState(),/stopped/);context.runtimeLifecycle.stopped=false;
failMap=true;await assert.rejects(context.requestParticleState(),/map rejected/);assert.equal(context.diagnosticsPending,false,'Failed readback releases the shared diagnostic buffer');
console.log('Explicit full native particle inspection preserves tick-zero bytes and failure identity');
