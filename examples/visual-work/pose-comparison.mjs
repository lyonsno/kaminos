import assert from 'node:assert/strict';
import path from 'node:path';

export default async function poseComparison({ page, document, open, retain, inputs, out, settle, observe }) {
  const id = inputs.objectId || document.activeObjectId;
  const source = document.objects.find(item => item.id === id);
  assert.ok(source, `Requested object ${id} absent`);
  const position = [...source.transform.position];
  position[0] += inputs.deltaX ?? 0.25;
  await page.evaluate(id => { window.selectSceneObject(id); window.setGizmoMode(null); }, id);
  const a = await retain({ name: 'a', settle, observe });
  await page.evaluate(({ id, position }) => window.kaminosSetSceneObjectTransform(id, { position }), { id, position });
  const b = await retain({ name: 'b', settle, observe });
  assert.deepEqual(b.document.objects.find(item => item.id === id).transform.position, position);
  for (const other of a.document.objects.filter(item => item.id !== id)) {
    assert.deepEqual(b.document.objects.find(item => item.id === other.id), other, 'Other authored object changed');
  }
  assert.deepEqual(b.document.camera, a.document.camera, 'Comparison camera changed');
  await page.evaluate(() => window.kaminosSceneEdits.undo());
  const undone = await page.evaluate(id => window.kaminosSceneObjectDebugState().find(item => item.id === id), id);
  assert.ok(undone.transform.position.every((n, i) => Math.abs(n - source.transform.position[i]) < 1e-8));
  await open(b.filename);
  await settle?.(page);
  await page.screenshot({ path: path.join(out, 'reopened-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(out, 'reopened-mobile.png') });
  return { objectId: id, handoff: { filename: b.filename, url: b.url },
    next: 'Noah edits and saves this document; use his saved filename as the next --scene input.' };
}
