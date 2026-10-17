// fast-simplification 0.2.0 as Wasm (vendor/fast-simplification) for the
// browser mesh finisher. Its native contraction sites run as relaxed-SIMD
// fused multiply-adds, so it equals the native wheel only where the engine
// fuses them; probeRelaxedFma checks that before the module is used, and
// otherwise the finisher keeps the JS port (which emulates the fusion exactly).
import factory from './vendor/fast-simplification/fast-simplification-0.2.0.mjs';
import {fma,simplifyMesh} from './mesh-simplify.js';

export const WASM_SIMPLIFY_ROUTE='fast-simplification 0.2.0 Wasm (relaxed-SIMD fused multiply-add)';
export const JS_SIMPLIFY_ROUTE='fast-simplification 0.2.0 JS port (emulated fused multiply-add)';

// (func (param f64 f64 f64) (result f64)) = lane 0 of f64x2.relaxed_madd(splat a, splat b, splat c)
const leb=n=>{const o=[];do{let b=n&0x7f;n>>>=7;if(n)b|=0x80;o.push(b);}while(n);return o;};
const section=(id,bytes)=>[id,...leb(bytes.length),...bytes];
const MADD_BODY=[0x00,0x20,0,0xfd,...leb(20),0x20,1,0xfd,...leb(20),0x20,2,0xfd,...leb(20),0xfd,...leb(0x107),0xfd,...leb(33),0,0x0b];
const MADD_MODULE=new Uint8Array([0,97,115,109,1,0,0,0,
  ...section(1,[1,0x60,3,0x7c,0x7c,0x7c,1,0x7c]),...section(3,[1,0]),...section(7,[1,4,109,97,100,100,0,0]),
  ...section(10,[1,...leb(MADD_BODY.length),...MADD_BODY])]);
// Triples whose fused and unfused results differ.
const PROBES=[[1+2**-30,1+2**-30,-(1+2**-29)],[0.1,10,-1],[1/3,3,-1],[1+2**-52,1-2**-53,-1],[-(1+2**-27),1+2**-27,1+2**-26]];

export function probeRelaxedFma(){
  if(typeof WebAssembly!=='object'||!WebAssembly.validate(MADD_MODULE))return {fused:false,reason:'relaxed SIMD unavailable'};
  const madd=new WebAssembly.Instance(new WebAssembly.Module(MADD_MODULE)).exports.madd;
  for(const [a,b,c] of PROBES)if(!Object.is(madd(a,b,c),fma(a,b,c)))return {fused:false,reason:'relaxed_madd is not fused here'};
  return {fused:true};
}

// One simplify_mesh run: (points F32/F64 xyz, triangles I32/U32, target count,
// aggressiveness, preserveBorder, onIteration) -> {points: F64, triangles: I32}.
// A Wasm abort (e.g. a surface past 4 GB of Wasm memory) leaves the module
// unusable: that call and every later one run the JS port (identical bytes), the
// shared module is dropped so the next load starts fresh, and engine.fallback
// records why.
export function wasmSimplifierEngine(M){
  const js=(points,triangles,count,aggressiveness,preserveBorder,onIteration)=>
    simplifyMesh(points,triangles,{targetCount:count,aggressiveness,preserveBorder,onIteration});
  const engine=(points,triangles,count,aggressiveness,preserveBorder,onIteration)=>{
    if(engine.fallback)return js(points,triangles,count,aggressiveness,preserveBorder,onIteration);
    try{return wasm(points,triangles,count,aggressiveness,preserveBorder,onIteration);}
    catch(error){
      if(!(error instanceof WebAssembly.RuntimeError))throw error;
      engine.fallback={reason:'Wasm simplifier aborted ('+error.message+'); JS port used'};
      if(loaded===M)loading=null;
      return js(points,triangles,count,aggressiveness,preserveBorder,onIteration);
    }
  };
  engine.fallback=null;
  return engine;
  function wasm(points,triangles,count,aggressiveness,preserveBorder,onIteration){
    const nv=points.length/3,nt=triangles.length/3;
    // fs_simplify takes ownership of both input buffers and frees them once loaded.
    // Wasm addresses are unsigned: index the heaps with >>> so buffers above 2 GiB work.
    const pp=M._malloc(points.length*8),pt=M._malloc(triangles.length*4);
    M.HEAPF64.set(points,pp>>>3);M.HEAP32.set(new Int32Array(triangles.buffer,triangles.byteOffset,triangles.length),pt>>>2);
    M.onIteration=onIteration;
    try{
      const nOut=M._fs_simplify(nv,nt,pp,pt,count,aggressiveness,preserveBorder?1:0),np=M._fs_points();
      const op=M._malloc(np*24),ot=M._malloc(nOut*12);
      try{M._fs_read(op,ot);return {points:M.HEAPF64.slice(op>>>3,(op>>>3)+np*3),triangles:M.HEAP32.slice(ot>>>2,(ot>>>2)+nOut*3)};}
      finally{M._free(op);M._free(ot);}
    }finally{M.onIteration=undefined;try{M._fs_release();}catch{}}
  }
}

let loading=null,loaded=null;
// -> {engine, route, reason?}; engine is null when the JS port must be used.
export function loadSimplifier({prefer='auto'}={}){
  if(prefer==='js')return Promise.resolve({engine:null,route:JS_SIMPLIFY_ROUTE,reason:'JS port requested'});
  if(prefer!=='auto')throw TypeError("simplifier must be 'auto' or 'js'");
  return loading??=(async()=>{
    const probe=probeRelaxedFma();
    if(!probe.fused)return {engine:null,route:JS_SIMPLIFY_ROUTE,reason:probe.reason};
    loaded=await factory();
    return {engine:wasmSimplifierEngine(loaded),route:WASM_SIMPLIFY_ROUTE};
  })();
}
