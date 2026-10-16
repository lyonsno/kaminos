// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../tools/vantage.mjs', import.meta.url));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`;

function fakeServer(respond) {
  const received = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const parsed = body ? JSON.parse(body) : null;
      received.push({method: request.method, url: request.url, headers: request.headers, body: parsed});
      const [status, payload] = respond(request, parsed);
      response.writeHead(status, {'Content-Type': 'application/json'});
      response.end(JSON.stringify(payload));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({server, received, url: `http://127.0.0.1:${server.address().port}`})));
}

const run = (args, env = {}) => new Promise(resolve => {
  execFile(process.execPath, [cli, ...args], {env: {...process.env, ...env}}, (error, stdout, stderr) => resolve({code: error ? error.code : 0, stdout, stderr}));
});

const snapReply = (command, args) => ({ok: true, id: 'c1', command, page: {id: 'page-aaaaaaaa', href: 'http://127.0.0.1/index.html', title: 'Kaminos'}, elapsedMs: 40,
  result: {schema: 'kaminos.agent-vantage.v1', kind: command, route: 'viewport-borrow', pilot: args.pilot, layers: ['kaminos-host-renderer-canvas'],
    image: {width: 1, height: 1}, view: {position: [0, 1, 3], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 1000},
    images: [{name: command, mime: 'image/png', dataUrl, width: 1, height: 1}, ...(args.annotate ? [{name: 'annotated', mime: 'image/png', dataUrl, width: 1, height: 1}] : [])],
    objects: {inView: [{id: 'centre', label: 'Centre box', type: 'mesh', distance: 3, rect: [0.4, 0.4, 0.6, 0.6], center: [0.5, 0.5], coverage: 0.04, partial: false, bearing: {right: 0, up: 0}}],
      outOfView: [{id: 'side', label: 'Side box', type: 'mesh', distance: 5.8, bearing: {right: -59, up: 0}}], occlusion: 'not-tested'}}});

test('snap validates locally, asks the server, and keeps each picture with a JSON record', async t => {
  const {server, received, url} = await fakeServer((request, body) => [200, snapReply(body.command, body.args)]);
  const out = mkdtempSync(path.join(tmpdir(), 'vantage-cli-'));
  t.after(() => { server.close(); rmSync(out, {recursive: true, force: true}); });
  const result = await run(['--server', url, '--out', out, 'snap', '--annotate', '--name', 'burner check']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(received.length, 1);
  assert.equal(received[0].url, '/api/vantage/command');
  assert.equal(received[0].headers['content-type'], 'application/json');
  assert.equal(received[0].body.command, 'snap');
  assert.equal(received[0].body.args.pilot, 'bebop');
  assert.equal(received[0].body.args.annotate, true);
  assert.equal(received[0].body.args.settle, 2, 'arguments are normalized by the shared module before sending');
  const files = readdirSync(out).sort();
  const pngs = files.filter(name => name.endsWith('.png'));
  assert.equal(pngs.length, 2);
  assert.ok(pngs.some(name => name.endsWith('-burner-check-snap.png')) && pngs.some(name => name.endsWith('-burner-check-annotated.png')), files.join(', '));
  for (const name of pngs) assert.deepEqual(readFileSync(path.join(out, name)), PNG);
  const record = JSON.parse(readFileSync(path.join(out, files.find(name => name.endsWith('.json'))), 'utf8'));
  assert.equal(record.result.images[0].dataUrl, undefined, 'the record points at files instead of embedding pixels');
  assert.ok(record.result.images[0].path.endsWith('.png'));
  assert.equal(record.request.server, url);
  assert.equal(record.request.command, 'snap');
  assert.match(result.stdout, /burner-check-snap\.png/);
  assert.match(result.stdout, /Centre box/);
  assert.match(result.stdout, /Side box/);
});

test('invalid commands fail before any request', async t => {
  const {server, received, url} = await fakeServer(() => [500, {}]);
  t.after(() => server.close());
  const result = await run(['--server', url, 'move', '--forward', 'abc']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /forward/);
  assert.equal(received.length, 0);
  const unknown = await run(['--server', url, 'teleport-everyone']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown/);
});

test('page and transport failures report their phase and exit nonzero', async t => {
  const {server, url} = await fakeServer((request, body) => body.command === 'status'
    ? [409, {ok: false, phase: 'select', error: 'No Kaminos page is linked to this server'}]
    : [200, {ok: false, phase: 'busy', error: 'The operator is dragging a gizmo', page: {id: 'page-aaaaaaaa'}}]);
  t.after(() => server.close());
  const select = await run(['--server', url, 'status']);
  assert.equal(select.code, 3);
  assert.match(select.stderr, /select: No Kaminos page/);
  const busy = await run(['--server', url, 'look', 'centre']);
  assert.equal(busy.code, 1);
  assert.match(busy.stderr, /busy: The operator is dragging a gizmo/);
  const unreachable = await run(['--server', 'http://127.0.0.1:9', 'status']);
  assert.equal(unreachable.code, 3);
  assert.match(unreachable.stderr, /Cannot reach Kaminos/);
});

test('goto reads coordinates and pilot, and pages lists linked tabs', async t => {
  const {server, received, url} = await fakeServer((request, body) => request.url === '/api/vantage/pages'
    ? [200, {schema: 'kaminos.agent-vantage.v1', pages: [{id: 'page-aaaaaaaa', title: 'Kaminos', href: 'http://127.0.0.1/index.html', visible: true, focused: true, connected: true, lastSeenAgoMs: 10, pendingCommands: 0}]}]
    : [200, {ok: true, page: {id: 'page-aaaaaaaa'}, result: {sub: {pilot: body.args.pilot, label: 'Scout', pose: {position: body.args.position, rotation: [0, 0, 0], scale: [1, 1, 1]}}}}]);
  t.after(() => server.close());
  const moved = await run(['--server', url, '--pilot', 'scout', 'goto', '1', '2', '-3.5', '--look', 'centre']);
  assert.equal(moved.code, 0, moved.stderr);
  assert.deepEqual(received.at(-1).body.args, {pilot: 'scout', position: [1, 2, -3.5], lookAt: 'centre'});
  const pages = await run(['--server', url, 'pages']);
  assert.equal(pages.code, 0, pages.stderr);
  assert.match(pages.stdout, /page-aaaaaaaa/);
});

test('map writes the painted map, and pictures can leave it out', async t => {
  const sketchResult = {schema: 'kaminos.scene-sketch.v1', objects: [{id: 'centre', label: 'Centre box', type: 'mesh', bounds: {min: [0, 0, 0], max: [1, 1, 1]}}],
    fields: [], subs: [], operator: {view: {position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 40, near: 0.1, far: 100}, aspect: 1.5}};
  const {server, received, url} = await fakeServer((request, body) => [200, body.command === 'map'
    ? {ok: true, page: {id: 'page-aaaaaaaa'}, result: {schema: 'kaminos.agent-vantage.v1', kind: 'map', scaleBar: {meters: 1, pixels: 40},
      images: [{name: 'map', mime: 'image/png', dataUrl, width: 1, height: 1}], sketch: sketchResult}}
    : body.command === 'sketch' ? {ok: true, page: {id: 'page-aaaaaaaa'}, result: sketchResult}
    : snapReply(body.command, body.args)]);
  const out = mkdtempSync(path.join(tmpdir(), 'vantage-cli-map-'));
  t.after(() => { server.close(); rmSync(out, {recursive: true, force: true}); });
  const map = await run(['--server', url, '--out', out, 'map', '--size', '320']);
  assert.equal(map.code, 0, map.stderr);
  assert.deepEqual(received.at(-1).body, {command: 'map', args: {size: 320}, timeoutMs: 30000});
  assert.ok(readdirSync(out).some(name => name.endsWith('-map.png')));
  assert.match(map.stdout, /map/);
  const snap = await run(['--server', url, '--out', out, 'snap', '--no-map']);
  assert.equal(snap.code, 0, snap.stderr);
  assert.equal(received.at(-1).body.args.map, false);
  const sketch = await run(['--server', url, 'sketch']);
  assert.equal(sketch.code, 0, sketch.stderr);
  assert.equal(received.at(-1).body.command, 'sketch');
  assert.match(sketch.stdout, /Centre box/);
});

const pickReply = args => ({ok: true, id: 'c2', command: 'pick', page: {id: 'page-aaaaaaaa', title: 'Kaminos'}, elapsedMs: 3,
  result: {schema: 'kaminos.agent-vantage.v1', kind: 'pick', from: args.pictured ? 'picture' : args.optics ? 'camera' : 'vantage-bebop', at: args.at,
    referent: args.pictured ? 'pictured' : 'rendered', ray: {origin: [0, 1, 6], direction: [0, -0.1, -1]},
    hit: args.pictured?.n === 0 ? null : {id: 'kiln', label: 'Kiln', type: 'glb', authority: 'approximate', now: 'present', distance: 5.52,
      point: [0.2, 0.45, 0.5], local: [0.2, 0.05, 0.5], normal: [0, 0, 1], pointBasis: 'recast',
      surface: {path: [0, 2], mesh: 'Beam', face: 17, instance: null}, geometry: {status: 'same'}},
    ...(args.pictured?.n === 0 ? {drawn: {kind: 'nothing'}} : {}),
    unresolved: [{id: 'flame-field', label: 'Fire & smoke', type: 'simulation-domain', distance: 4.1, reason: 'simulation fields are drawn outside the pick map'}],
    fields: [{id: 'flame-field', label: 'Fire & smoke', type: 'simulation-domain', enter: 4.1, exit: 6.3}]}});

test('pick sends picture fractions and says what the ray hits', async t => {
  const {server, received, url} = await fakeServer((request, body) => [200, pickReply(body.args)]);
  t.after(() => server.close());
  const result = await run(['--server', url, 'pick', '0.5', '0.25']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(received[0].body.args, {pilot: 'bebop', from: 'sub', at: [0.5, 0.25]});
  assert.match(result.stdout, /Kiln/);
  assert.match(result.stdout, /Beam/);
  assert.match(result.stdout, /Fire & smoke/);
  const pixels = await run(['--server', url, 'pick', '640', '360']);
  assert.equal(pixels.code, 2, 'pixels need the picture they belong to');
  assert.match(pixels.stderr, /--picture/);
});

// A kept picture's pick map: 4x2 pixels. The top row shows nothing, then the kiln; the bottom row shows instance 1 of the rocks.
const matrix = value => Array.from({length: 16}, (_, i) => (i % 5 === 0 ? value : 0));
const kilnRow = {n: 3, id: 'kiln', label: 'Kiln', type: 'glb', path: [0, 2], mesh: 'Beam', matrixWorld: matrix(1), root: matrix(1), geometry: {uuid: 'g'}};
const rocksRow = {n: 5, id: 'rocks', label: 'Rocks', type: 'glb', path: [0], mesh: null, matrixWorld: matrix(2), root: matrix(2), geometry: {uuid: 'r'},
  instances: {1: matrix(4)}};
const pickMap = (objects, runs) => ({schema: 'kaminos.vantage-pick-map.v1', width: 4, height: 2, runs, objects,
  clouds: [{id: 'plume', label: 'Plume', type: 'splat', bounds: {min: [0, 0, 0], max: [1, 1, 1]}}], fields: [], water: false});

test('pick on a kept picture looks the pixel up in its pick map and sends what the picture drew there', async t => {
  const {server, received, url} = await fakeServer((request, body) => [200, pickReply(body.args)]);
  const out = mkdtempSync(path.join(tmpdir(), 'vantage-cli-'));
  t.after(() => { server.close(); rmSync(out, {recursive: true, force: true}); });
  const optics = {projection: Array.from({length: 16}, (_, i) => i / 10), viewInverse: Array.from({length: 16}, (_, i) => -(i + 1) / 10)};
  const frameOptics = {projection: Array.from({length: 16}, () => 2), viewInverse: Array.from({length: 16}, () => 3)};
  const recordPath = path.join(out, 'burst.json');
  writeFileSync(recordPath, JSON.stringify({result: {kind: 'burst', image: {width: 1280, height: 720}, optics,
    frames: [{index: 0, optics, pickMap: pickMap([kilnRow], '0 0 2 3 0 2 0 0 4')},
      {index: 1, optics: frameOptics, pickMap: pickMap([rocksRow], '0 0 4 5 1 4')}]}}));
  const first = await run(['--server', url, 'pick', '960', '180', '--picture', recordPath]);
  assert.equal(first.code, 0, first.stderr);
  const {geometry, ...kiln} = kilnRow;
  assert.deepEqual(received[0].body.args, {pilot: 'bebop', from: 'sub', at: [0.875, 0.25], optics,
    pictured: {...kiln, geometry, instance: 0, pixel: [3, 0]}, scene: {clouds: pickMap([], '').clouds, fields: [], water: false}},
    'a burst without --frame is its first frame; the kiln drew that pixel, picked through its centre');
  assert.match(first.stdout, /Kiln/);
  assert.match(first.stdout, /the picture drew/);
  const second = await run(['--server', url, 'pick', '0', '720', '--picture', recordPath, '--frame', '2']);
  assert.equal(second.code, 0, second.stderr);
  const sent = received[1].body.args;
  assert.deepEqual(sent.optics, frameOptics, '--frame picks from that frame of a burst');
  assert.equal(sent.pictured.id, 'rocks');
  assert.equal(sent.pictured.instance, 1);
  assert.deepEqual(sent.pictured.instanceMatrix, matrix(4), 'the instance travels with the matrix it was drawn with');
  assert.equal(sent.pictured.instances, undefined, 'not the whole table');
  const empty = await run(['--server', url, 'pick', '10', '10', '--picture', recordPath]);
  assert.equal(empty.code, 0, empty.stderr);
  assert.deepEqual(received[2].body.args.pictured, {n: 0, instance: 0, pixel: [0, 0]}, 'where the picture drew nothing, that is the answer');
  assert.match(empty.stdout, /drew nothing/);
});

test('a picture kept without a pick map is refused unless today\'s scene is asked for', async t => {
  const {server, received, url} = await fakeServer((request, body) => [200, pickReply(body.args)]);
  const out = mkdtempSync(path.join(tmpdir(), 'vantage-cli-'));
  t.after(() => { server.close(); rmSync(out, {recursive: true, force: true}); });
  const optics = {projection: Array.from({length: 16}, (_, i) => i + 1), viewInverse: Array.from({length: 16}, (_, i) => -(i + 1))};
  const recordPath = path.join(out, 'old.json');
  writeFileSync(recordPath, JSON.stringify({result: {kind: 'snap', image: {width: 100, height: 100}, optics,
    scenePose: [{id: 'kiln', root: matrix(1), meshes: []}]}}));
  const refused = await run(['--server', url, 'pick', '50', '50', '--picture', recordPath]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /pick map/);
  assert.match(refused.stderr, /--now/, 'it says how to cast that camera into the scene as it is now');
  assert.equal(received.length, 0);
  const now = await run(['--server', url, 'pick', '50', '50', '--picture', recordPath, '--now']);
  assert.equal(now.code, 0, now.stderr);
  assert.deepEqual(received[0].body.args, {pilot: 'bebop', from: 'sub', at: [0.5, 0.5], optics});
  assert.match(now.stdout, /draws there now/);
});

test('a picture\'s depth is kept as a file beside it, and a pick reads the depth at its pixel', async t => {
  const out = mkdtempSync(path.join(tmpdir(), 'vantage-cli-'));
  // Depth for a 4x2 map: 9.5 where the kiln was drawn, nothing elsewhere.
  const depths = new Float32Array(8); depths[2] = 9.5; depths[3] = 9.75;
  const bytes = Buffer.alloc(32); depths.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  const map = {...pickMap([kilnRow], '0 0 2 3 0 2 0 0 4'), depth: {encoding: 'float32le-base64', unit: 'view-depth', width: 4, height: 2, data: bytes.toString('base64')}};
  const {server, received, url} = await fakeServer((request, body) => [200, body.command === 'pick' ? pickReply(body.args)
    : {...snapReply(body.command, body.args), result: {...snapReply(body.command, body.args).result, image: {width: 1280, height: 640},
      optics: {projection: Array(16).fill(1), viewInverse: Array(16).fill(2)}, pickMap: map}}]);
  t.after(() => { server.close(); rmSync(out, {recursive: true, force: true}); });
  const snap = await run(['--server', url, '--out', out, 'snap', '--name', 'kiln']);
  assert.equal(snap.code, 0, snap.stderr);
  const depthFile = readdirSync(out).find(name => name.endsWith('-depth.f32'));
  assert.ok(depthFile, 'the depth is written as its own file');
  assert.deepEqual(readFileSync(path.join(out, depthFile)), bytes);
  const recordPath = path.join(out, readdirSync(out).find(name => name.endsWith('.json')));
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  assert.equal(record.result.pickMap.depth.data, undefined, 'the record keeps a path, not the data');
  assert.equal(record.result.pickMap.depth.path, path.join(out, depthFile));
  const picked = await run(['--server', url, 'pick', '1000', '100', '--picture', recordPath]);
  assert.equal(picked.code, 0, picked.stderr);
  const sent = received.at(-1).body.args;
  assert.equal(sent.pictured.depth, 9.75, 'the depth the picture drew at pixel 3, 0');
  assert.deepEqual(sent.pictured.pixel, [3, 0]);
  rmSync(path.join(out, depthFile));
  const lost = await run(['--server', url, 'pick', '1000', '100', '--picture', recordPath]);
  assert.equal(lost.code, 2, 'a picture whose depth file is gone is not picked as if it had none');
  assert.match(lost.stderr, /depth/);
});

test('a burst keeps depth only when asked', async t => {
  const {server, received, url} = await fakeServer((request, body) => [200, snapReply(body.command, body.args)]);
  t.after(() => server.close());
  await run(['--server', url, 'burst', '--count', '2']);
  assert.equal(received.at(-1).body.args.depth, false);
  await run(['--server', url, 'burst', '--count', '2', '--depth']);
  assert.equal(received.at(-1).body.args.depth, true);
});

test('glance asks the page for the sub\'s own view and keeps the picture', async t => {
  const {server, received, url} = await fakeServer((request, body) => [200, snapReply(body.command, body.args)]);
  const out = mkdtempSync(path.join(tmpdir(), 'vantage-cli-'));
  t.after(() => { server.close(); rmSync(out, {recursive: true, force: true}); });
  const result = await run(['--server', url, '--out', out, 'glance', '--max-size', '640', '--name', 'look']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(received[0].body.command, 'glance');
  assert.deepEqual(received[0].body.args, {pilot: 'bebop', maxSize: 640, annotate: false, map: true});
  assert.ok(readdirSync(out).some(name => name.endsWith('-look-glance.png')));
});

test('live turns the sub\'s live view on and off', async t => {
  const {server, received, url} = await fakeServer((request, body) => [200, {ok: true, id: 'c', command: 'live', page: {id: 'page-a'}, elapsedMs: 1,
    result: {schema: 'kaminos.agent-vantage.v1', kind: 'live', live: {on: body.args.on, pilot: 'bebop', fps: body.args.fps ?? 4, frames: 0, skipped: 0, drawMs: null}}}]);
  t.after(() => server.close());
  const on = await run(['--server', url, 'live', 'on', '--fps', '6']);
  assert.equal(on.code, 0, on.stderr);
  assert.deepEqual(received[0].body.args, {pilot: 'bebop', on: true, fps: 6});
  assert.match(on.stdout, /live view on/);
  const off = await run(['--server', url, 'live', 'off']);
  assert.equal(off.code, 0, off.stderr);
  assert.equal(received[1].body.args.on, false);
  const bad = await run(['--server', url, 'live', 'maybe']);
  assert.equal(bad.code, 2);
});

test('recheck reads an anchor, or a pick record, and says whether its mesh is the one picked', async t => {
  const {server, received, url} = await fakeServer((request, body) => [200, {ok: true, id: 'c', command: 'recheck', page: {id: 'page-a'}, elapsedMs: 1,
    result: {now: 'present', status: 'edited'}}]);
  const out = mkdtempSync(path.join(tmpdir(), 'vantage-cli-'));
  t.after(() => { server.close(); rmSync(out, {recursive: true, force: true}); });
  const anchorPath = path.join(out, 'anchor.json'), pickPath = path.join(out, 'pick.json'), identity = {uuid: 'g', vertices: 24, sample: '0badf00d'};
  writeFileSync(anchorPath, JSON.stringify({kind: 'point', id: 'beam', label: 'Beam', path: [0, 1], geometry: identity, local: [0, 0, 0]}));
  writeFileSync(pickPath, JSON.stringify({result: {kind: 'pick', hit: {id: 'beam', surface: {path: [0, 1]}, geometry: {status: 'same', identity}}}}));
  const fromAnchor = await run(['--server', url, 'recheck', '--anchor', anchorPath]);
  assert.equal(fromAnchor.code, 0, fromAnchor.stderr);
  assert.deepEqual(received[0].body, {command: 'recheck', args: {id: 'beam', path: [0, 1], identity}, timeoutMs: 30000});
  assert.match(fromAnchor.stdout, /beam.*edited/);
  const fromPick = await run(['--server', url, 'recheck', '--anchor', pickPath]);
  assert.equal(fromPick.code, 0, fromPick.stderr);
  assert.deepEqual(received[1].body.args, {id: 'beam', path: [0, 1], identity});
  const bad = await run(['--server', url, 'recheck']);
  assert.equal(bad.code, 2);
});

test('a pick saved before identities were kept carries none, so its recheck cannot claim a status', async t => {
  const {server, received, url} = await fakeServer((request, body) => [200, {ok: true, id: 'c', command: 'recheck', page: {id: 'page-a'}, elapsedMs: 1,
    result: {now: 'present', status: 'unverified'}}]);
  const out = mkdtempSync(path.join(tmpdir(), 'vantage-cli-'));
  t.after(() => { server.close(); rmSync(out, {recursive: true, force: true}); });
  const legacy = path.join(out, 'legacy-pick.json');
  writeFileSync(legacy, JSON.stringify({result: {kind: 'pick', hit: {id: 'beam', surface: {path: [0]}, geometry: {status: 'same'}}}}));
  const result = await run(['--server', url, 'recheck', '--anchor', legacy]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(received[0].body.args, {id: 'beam', path: [0], identity: null}, 'the status wrapper is not an identity');
});
