export function validateEpisode(state, source) {
  const run=state?.runs?.at(-1);
  if(state?.status!=='done'||run?.status!=='done')throw Error('Both models must complete');
  if(state.source!==source||run.source!==source)throw Error('Wrong photograph source');
  if(state.identity?.sharedDevice!==true||state.identity.backend?.kind!=='webgpu-local')throw Error('Actual shared WebGPU device required');
  if(!['local','hosted'].includes(run.moge?.weights))throw Error('Real MoGe weights required');
  if(state.identity.supermat?.routeId!=='supermat.image-to-pbr.webgpu-local.v0')throw Error('Actual SuperMat route required');
  if(!(run.output?.triangles>0&&run.output?.surfaceVertices>0))throw Error('Nonempty depth surface required');
  if(!run.output.materialSize?.every(x=>Number.isInteger(x)&&x>0)||run.output.materialSize.length!==2)throw Error('Material output required');
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
  }
}
