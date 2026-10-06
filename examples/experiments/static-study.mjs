import assert from 'node:assert/strict';
import { experiment } from '../../experiment-work.mjs';

export default async function(context) {
  const work=experiment(context);
  await work.observe('before');
  const unchanged=context.document.objects.find(o=>o.id==='green-sphere');
  await work.pose('red-block',{position:[-.4,.5,.3]});
  const moved=await work.observe('moved');
  assert.deepEqual(moved.document.objects.find(o=>o.id===unchanged.id).transform,unchanged.transform);
  await context.open(moved.filename);
  const reopened=await work.observe('reopened');
  assert.deepEqual(reopened.document.objects.find(o=>o.id==='red-block').transform.position,[-.4,.5,.3]);
  return {handoff:{url:reopened.url,filename:reopened.filename}};
}
