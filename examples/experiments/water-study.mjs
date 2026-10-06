import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { experiment, pausedWaterUrl } from '../../experiment-work.mjs';
import { viewsAround } from '../../experiment-scene.mjs';
export const configureUrl = pausedWaterUrl;

export default async function (context) {
  const { document, inputs, open } = context, work = experiment(context);
  const views = JSON.parse(await fs.readFile(inputs.views, 'utf8'));
  await work.water.hold();
  assert.equal((await work.water.read()).clock.completedSteps, 0);
  const sibling = document.objects.find(o => o.id === 'right-source');
  const position = [...document.objects.find(o => o.id === 'left-source').transform.position]; position[0] += .25;
  await work.pose('left-source', { position });
  const observations = [];
  let seen;
  for (const seconds of inputs.seconds || [1, 3]) {
    await work.water.advanceTo(seconds);
    for (const view of views.filter(v => (inputs.viewNames || ['front', 'three-quarter']).includes(v.name))) {
      await work.camera(view);
      const result = await work.observe(`water-${seconds}-${view.name}`, { water: true });
      seen=result.observed;
      assert.deepEqual(result.document.objects.find(o => o.id === sibling.id).transform, sibling.transform);
      observations.push({ filename: result.filename, url: result.url, clock: result.observed.water.clock });
    }
  }
  if (!observations.length) throw Error('Choose at least one observation time and existing camera');
  // After the broad comparison, inspect the source that actually moved. Bounds
  // describe an authored inspection region; the picture supplies the liquid.
  const changed=seen.objects.find(object=>{
    const original=document.objects.find(o=>o.id===object.id);
    return object.type==='local-liquid-emitter' && original
      && object.transform.position.some((value,i)=>Math.abs(value-original.transform.position[i])>1e-8);
  });
  if(!changed)throw Error('Observation did not contain the edited source');
  const [x,y,z]=changed.transform.position;
  const [detail]=viewsAround([{id:changed.id,min:[x-.5,y-.8,z-.2],max:[x+.5,y+.3,z+1.8]}],
    {directions:[{name:'edited-source-detail',direction:[-1,.45,1]}]});
  await work.camera(detail);
  const closer=await work.observe('edited-source-detail',{water:true});
  assert.equal(closer.observed.water.clock.runId,seen.water.clock.runId);
  assert.equal(closer.observed.water.clock.completedSteps,seen.water.clock.completedSteps);
  observations.push({filename:closer.filename,url:closer.url,clock:closer.observed.water.clock,reason:'inspect observed edited source',objectId:changed.id});
  const handoff = observations.at(-1);
  const reopened = await open(handoff.filename);
  assert.deepEqual(reopened.objects.find(o => o.id === 'left-source').transform.position, position);
  await work.water.hold();
  assert.equal((await work.water.read()).clock.completedSteps, 0, 'Reopening preserves authored setup and starts a new runtime');
  return { observations, handoff };
}
