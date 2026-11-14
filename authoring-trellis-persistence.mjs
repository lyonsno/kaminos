// Shared ordinary storage of TRELLIS mesh, surfels and raw recovery fields.
// Levels remain independent of the saved asset's success, but their owner awaits them on retirement.
export function createTrellisAuthoringPersistence({request=globalThis.fetch,loadModule=specifier=>import(specifier),levelsStarted=()=>{}}={}){
 const tasks=new Set();
 const sha256Of=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const storeMesh=async(glb,generation,label,suffix,clientPreparesLods=false,assertCurrent=()=>{})=>{
    assertCurrent();
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',glb)),b=>b.toString(16).padStart(2,'0')).join('');
    const response=await request('/api/ingest-mesh'+(clientPreparesLods?'?role=client-prepares-lods':''),{method:'POST',headers:{'Content-Type':'model/gltf-binary'},body:glb});assertCurrent();const saved=await response.json();assertCurrent();
    if(!response.ok||saved.sha256!==sha256||saved.bytes!==glb.byteLength)throw Error(saved.error||'Generated mesh storage returned a different artifact');
    const result={source:saved.source,sha256,name:`${label} · ${suffix}.glb`,generation:{...generation,sha256,bytes:glb.byteLength}};
    const originResponse=await request('/api/mesh-generation-origin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});assertCurrent();const origin=await originResponse.json();assertCurrent();
    if(!originResponse.ok||origin.result?.sha256!==sha256||origin.result?.generation?.runId!==generation.runId)throw Error(origin.error||'Generation origin storage returned a different result');
    return result;
  };

  const persist=async(out,{assertCurrent=()=>{}}={})=>{
    assertCurrent();
    const persistGeneratedMesh=(...args)=>storeMesh(...args.slice(0,4),args[4]??false,assertCurrent);
    // Preserve the exact decode and material samples before optional exports or
    // GI workers can consume them. A normal GLB shows the raw geometry and also
    // carries the original fields, losslessly, for recovery without inference.
    let reconstruction=null;
    if(out.levelInputs){
      const {encodeTrellisReconstruction}=await loadModule('./trellis-reconstruction.mjs');
      const raw=encodeTrellisReconstruction(out.levelInputs,{provenance:out.generation});
      reconstruction=await persistGeneratedMesh(raw,{...out.generation,representation:'trellis-raw-reconstruction',frame:'trellis-source',receiptValidation:{...out.generation.receiptValidation,checks:[...(out.generation.receiptValidation?.checks??[]),'raw-reconstruction-glb-encoded']}},out.label,'TRELLIS raw recovery');
    }
    const retained=reconstruction?{source:reconstruction.source,sha256:reconstruction.sha256}:null;
    if(!out.glb){if(!out.surfelGlb){if(reconstruction)return reconstruction;throw Error('TRELLIS run produced neither a mesh, surfels nor recovery fields');}
      const saved=await persistGeneratedMesh(out.surfelGlb,{...out.generation,reconstruction:retained,representation:'trellis-surfels',frame:'trellis-source',surfels:undefined},out.label,'TRELLIS surfels');
      return {...saved,reconstruction:retained,surfels:{...out.surfels,sha256:saved.sha256,source:saved.source}};}
    let surfels=out.surfels??{status:'not built'};
    if(out.surfelGlb){
      try{const saved=await persistGeneratedMesh(out.surfelGlb,{...out.generation,representation:'trellis-surfels',frame:'trellis-source',meshSha256:await sha256Of(out.glb),surfels:undefined},out.label,'TRELLIS surfels');
        surfels={...surfels,sha256:saved.sha256,source:saved.source};}
      catch(error){surfels={...surfels,status:'not stored',error:String(error?.message||error)};}
    }
    const saved={...await persistGeneratedMesh(out.glb,{...out.generation,surfels,reconstruction:retained},out.label,'TRELLIS',true),surfels,reconstruction:retained};
    // GI proxy tiers (Stunt Doubles' prepareGenerationLevels) from this run's decode, registered as levels
    // of the stored hero. They build in a worker after the mesh is saved; the result never holds or fails it.
    if(out.levelInputs||out.glb){
      const inputs=out.levelInputs??{},heroGLB=out.glb?new Uint8Array(out.glb.slice(0)):null,source=saved.sha256;out.levelInputs=null;
      const surfelExtra=!inputs.surfelGLB&&!inputs.surfelSource&&/^[a-f0-9]{64}$/.test(surfels?.sha256??'')?{surfelSource:surfels.sha256}:{};
      const promise=(async()=>{
        const {runGenerationLevels}=await loadModule('./generation-levels-runner.mjs');
        return runGenerationLevels({completeMissing:true,...inputs,...surfelExtra,...(heroGLB?{heroGLB}:{}),source,input:`TRELLIS page run ${out.generation?.runId}`,route:out.generation?.route});
      })().catch(error=>({phase:'worker',error:String(error?.message||error)}));
      tasks.add(promise);promise.finally(()=>tasks.delete(promise));
      try{levelsStarted({source,label:out.label,promise});}catch(error){console.warn('Generation levels presentation failed',error);}
    }
    return saved;
  };

 return {persist,async retire(){await Promise.all([...tasks]);}};
}
