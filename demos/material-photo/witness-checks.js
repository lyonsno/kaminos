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
  const selector='.stage .title, .stage .stage-foot';
  const previous=await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),element=>{const prior=element.style.visibility;element.style.visibility='hidden';return prior;})`);
  try{
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    return await capture();
  }finally{
    await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).forEach((element,i)=>{element.style.visibility=${JSON.stringify(previous)}[i];})`);
  }
}
