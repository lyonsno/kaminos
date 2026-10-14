// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
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
