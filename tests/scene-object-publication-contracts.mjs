import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSceneObjectPublicationGuard, publishSceneObjectIfCurrent } from '../scene-object-publication.mjs';
import { createSceneLoadRequests } from '../scene-load-generation.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('a delayed splat object from a superseded scene is disposed before scene membership publication', async () => {
  const requests = createSceneLoadRequests();
  const oldRequest = requests.begin();
  const sceneObjects = [];
  const disposed = [];
  let releaseImport;
  const oldRestore = (async () => {
    const object = await new Promise(resolve => { releaseImport = resolve; });
    return publishSceneObjectIfCurrent({
      object,
      isCurrent: () => requests.isCurrent(oldRequest),
      publish: value => sceneObjects.push(value),
      discard: value => disposed.push(value),
    });
  })();

  const currentRequest = requests.begin();
  const emitter = {id:'current-water-emitter'};
  sceneObjects.push(emitter);
  const staleSplat = {id:'stale-splat'};
  releaseImport(staleSplat);

  assert.equal(await oldRestore, false);
  assert.deepEqual(sceneObjects, [emitter], 'stale splat does not contaminate the current scene');
  assert.deepEqual(disposed, [staleSplat], 'stale preview resources are released');
  assert.equal(requests.isCurrent(currentRequest), true);
});

test('a direct import is discarded after a newer scene mutates the publication generation', async () => {
  let mutationToken = 3;
  let releaseImport;
  const object = { id: 'late-direct-splat' };
  const published = [];
  const discarded = [];
  const importIsCurrent = createSceneObjectPublicationGuard({ getMutationToken: () => mutationToken });
  const pendingImport = (async () => {
    await new Promise(resolve => { releaseImport = resolve; });
    return publishSceneObjectIfCurrent({
      object,
      isCurrent: importIsCurrent,
      publish: value => published.push(value),
      discard: value => discarded.push(value),
    });
  })();

  mutationToken += 1; // A newer saved scene finishes while the direct PLY request is pending.
  releaseImport();

  assert.equal(await pendingImport, false);
  assert.deepEqual(published, [], 'the old import never enters the newer scene');
  assert.deepEqual(discarded, [object], 'the detached decoded object is disposed');
});

test('the asynchronous splat restore checks request ownership at the publication boundary', () => {
  const start = html.indexOf('async function greenroomImportSplat(');
  const end = html.indexOf('window.greenroomImportSplat =', start);
  const importer = html.slice(start, end);
  const guard = importer.indexOf('publishSceneObjectIfCurrent(');
  const attach = importer.indexOf('scene.add(value)');
  const register = importer.indexOf('registerSceneObject(value');
  assert.ok(guard >= 0 && guard < attach && attach < register,
    'the splat importer must dispose a stale result before attachment or authored registration');
  assert.match(importer, /isCurrent: options\.isCurrent/);
  assert.match(importer, /discard: disposeObjectTree/);
});

test('direct splat imports bind publication to the scene mutation generation', () => {
  const start = html.indexOf('async function greenroomImportSplat(');
  const end = html.indexOf('window.greenroomImportSplat =', start);
  const importer = html.slice(start, end);
  assert.match(importer, /createSceneObjectPublicationGuard\(/,
    'direct imports must capture scene identity after importer-owned clear/preview restoration and before network waits');
  assert.match(importer, /isCurrent: importIsCurrent/,
    'the final synchronous publication gate must reject imports superseded by a newer scene mutation');
  assert.match(importer, /if \(!importIsCurrent\(\)\) return null/,
    'a stale direct import must stop after asynchronous correction instead of decoding/publishing into a newer scene');
});
