export function validateEpisode(state, source, size) {
  const run=state?.runs?.at(-1);
  if(state?.status!=='done'||run?.status!=='done')throw Error('Both models must complete');
  if(state.source!==source||run.source!==source)throw Error('Wrong photograph source');
  if(state.identity?.sharedDevice!==true||state.identity.backend?.kind!=='webgpu-local')throw Error('Actual shared WebGPU device required');
  if(!['local','hosted'].includes(run.moge?.weights))throw Error('Real MoGe weights required');
  if(state.identity.supermat?.routeId!=='supermat.image-to-pbr.webgpu-local.v0')throw Error('Actual SuperMat route required');
  if(!(run.output?.triangles>0&&run.output?.surfaceVertices>0))throw Error('Nonempty depth surface required');
  if(!run.output.materialSize?.every(x=>Number.isInteger(x)&&x>0)||run.output.materialSize.length!==2)throw Error('Material output required');
  if(size!==undefined&&(run.supermat?.size!==size||!run.output.materialSize.every(value=>value===size)))throw Error('Effective material resolution differs from selected resolution');
}

export async function captureSurfaceFrame(evaluate, capture) {
  const selector='.stage .title, .stage .stage-foot, .stage .carousel, .stage .sun';
  const previous=await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),element=>{const prior=element.style.visibility;element.style.visibility='hidden';return prior;})`);
  try{
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    return await capture();
  }finally{
    await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).forEach((element,i)=>{element.style.visibility=${JSON.stringify(previous)}[i];})`);
  }
}

export function validateComparison(views) {
  const reference=views?.relit;
  if(!reference || reference.map!=='surface' || reference.physicalbaseline?.relit?.roughness!==.4 ||
      reference.physicalbaseline?.relit?.metalness!==0 || !reference.physicalbaseline.geometryId ||
      reference.normalsMatchSurface!==true) throw Error('Fair image-albedo baseline required');
  const close=(a,b)=>{
    if(typeof a==='number'||typeof b==='number')return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-4;
    if(a&&b&&typeof a==='object'&&typeof b==='object')return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>close(a[k],b[k]));
    return a===b;
  };
  for(const mode of ['original','photo','relit','materials']) {
    const view=views[mode];
    if(view?.mode!==mode||view.map!=='surface'||view.glow!==false||view.physicalbaseline?.exposure!==1)throw Error('Four comparable views with fixed exposure and glow off required');
    if(!close(view.camera,reference.camera)||!close(view.light,reference.light)||view.gi?.enabled!==reference.gi?.enabled||
        !close(view.gi?.settings,reference.gi?.settings)||!close(view.gi?.debugState?.estimator,reference.gi?.debugState?.estimator))throw Error('Comparison changed camera, light or GI');
    if(view.physicalbaseline.geometryId!==reference.physicalbaseline.geometryId||view.normalsMatchSurface!==true||
        view.physicalbaseline.environmentIntensity!==reference.physicalbaseline.environmentIntensity)throw Error('Comparison changed geometry, normals or environment');
    if(reference.environment)for(const key of ['environment','source','rotation','intensity','direct']){
      if(!Object.hasOwn(reference.environment,key)||view.environment?.[key]!==reference.environment[key])throw Error('Comparison changed HDR source or lighting');
    }
  }
  const materialKeys=['uuid','roughness','metalness','mapUUID','roughnessMapUUID','metalnessMapUUID','emissiveMapUUID','emissiveIntensity'];
  for(const mode of ['relit','materials']) {
    const baseline=views[mode].physicalbaseline;
    const configured=baseline[mode], active=baseline.activeMaterial;
    if(!configured||!active||!materialKeys.every(key=>Object.hasOwn(active,key)&&Object.hasOwn(configured,key)&&active[key]===configured[key])||
        typeof active.uuid!=='string'||!active.uuid||typeof active.mapUUID!=='string'||!active.mapUUID||active.emissiveIntensity!==0)
      throw Error('Effective comparison material and glow-off state required');
    if(mode==='relit'&&(active.roughness!==.4||active.metalness!==0||active.roughnessMapUUID!==null||
        active.metalnessMapUUID!==null||active.emissiveMapUUID!==null))throw Error('Effective image-albedo baseline required');
    if(mode==='materials'&&(active.roughness!==1||active.metalness!==1||typeof active.roughnessMapUUID!=='string'||
        !active.roughnessMapUUID||active.metalnessMapUUID!==active.roughnessMapUUID||active.mapUUID===reference.physicalbaseline.relit.mapUUID||
        active.uuid===reference.physicalbaseline.relit.uuid))throw Error('Effective inferred albedo and ORM maps required');
  }
}
