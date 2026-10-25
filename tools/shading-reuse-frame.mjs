export async function drawShadingFrame({renderer,pipeline,producerFrame,waitFrame=()=>new Promise(requestAnimationFrame)}) {
  const previous=renderer.info.frame;
  do {await waitFrame();} while(renderer.info.frame<=previous);
  const before=producerFrame();
  const frame=renderer.info.frame;
  pipeline.render();
  await renderer.backend.device.queue.onSubmittedWorkDone();
  const after=producerFrame();
  if(after!==before+1)throw Error('Shading producer did not advance exactly once for the requested frame');
  return {frame,before,after};
}
