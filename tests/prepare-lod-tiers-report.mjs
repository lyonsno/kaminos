// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tool = path.resolve('tools/prepare-lod-tiers.mjs');
const run = (args, env = {}) => { try { execFileSync(process.execPath, [tool, ...args], {env: {...process.env, ...env}, stdio: 'pipe'}); return 0; } catch (e) { return e.status; } };

test('a dependency that cannot load still ends in a failure report naming the phase', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-report-')), report = path.join(dir, 'report.json');
  const status = run(['--input', dir, '--source', 'a'.repeat(64), '--server', 'http://127.0.0.1:9', '--report', report],
    {KAMINOS_LOD_THREE_MODULE: 'kaminos-missing-module-for-test'});
  assert.notEqual(status, 0);
  const r = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(r.phase, 'load-modules');
  assert.match(r.error.message, /kaminos-missing-module-for-test/);
  assert.ok(r.finishedAt);
});

test('bad arguments end in a failure report, not a silent exit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-report-')), report = path.join(dir, 'report.json');
  assert.notEqual(run(['--input', dir, '--source', 'nothex', '--server', 'http://127.0.0.1:9', '--report', report]), 0);
  const r = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(r.phase, 'admission');
  assert.match(r.error.message, /required/);
});

test('a taken level slot is refused before anything is stored', async () => {
  const {spawn} = await import('node:child_process');
  const http = await import('node:http');
  // Minimal stand-in server: source stored, a 200-face closed-remesh level already registered.
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url.split('?')[0]}`);
    if (req.url.startsWith('/api/read')) { res.writeHead(200); res.end('x'); return; }
    if (req.method === 'GET' && req.url.startsWith('/api/mesh-lods')) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({levels: [{sha256: 'b'.repeat(64), faces: 200, route: 'closed-remesh+projection+trellis-simplify'}]})); return; }
    res.writeHead(500); res.end('unexpected');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-slot-')), report = path.join(dir, 'report.json');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({materialResolution: 4}));
  for (const [n, a] of [['vertices.f32', new Float32Array([0,0,0, 1,0,0, 0,1,0])], ['triangles.u32', new Uint32Array([0,1,2])],
    ['material.features.f32', new Float32Array(6)], ['material.coordinates.i32', new Int32Array(3)]]) fs.writeFileSync(path.join(dir, n), Buffer.from(a.buffer));
  const child = spawn(process.execPath, [tool, '--input', dir, '--source', 'a'.repeat(64), '--server', `http://127.0.0.1:${server.address().port}`,
    '--targets', '200', '--report', report], {stdio: 'ignore'});
  const status = await new Promise(r => child.on('exit', r));
  server.close();
  assert.notEqual(status, 0);
  const r = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(r.phase, 'preflight');
  assert.match(r.error.message, /200-face .* already registered/);
  assert.ok(!calls.some(c => c.startsWith('POST')), `nothing stored: ${calls}`);
});

// A GLB holding the input triangle, with the TRELLIS encoder's node matrix (-90 deg about X) so its
// world frame matches the levels', optionally offset to make the frames disagree, and with shading
// normals unless `normals` is false.
function triangleGLB(offset = 0, {normals = true} = {}) {
  const pos = new Float32Array([0,0,0, 1,0,0, 0,1,0].map((v, i) => v + (i % 3 === 0 ? offset : 0))), idx = new Uint32Array([0,1,2]);
  const nrm = new Float32Array([0,0,1, 0,0,1, 0,0,1]), arrays = [pos, idx, ...(normals ? [nrm] : [])];
  const bin = new Uint8Array(arrays.reduce((n, a) => n + a.byteLength, 0)); let at = 0; const bufferViews = [];
  for (const a of arrays) { bin.set(new Uint8Array(a.buffer), at); bufferViews.push({buffer: 0, byteOffset: at, byteLength: a.byteLength}); at += a.byteLength; }
  const json = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0, matrix: [1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]}],
    meshes: [{primitives: [{attributes: {POSITION: 0, ...(normals ? {NORMAL: 2} : {})}, indices: 1}]}], buffers: [{byteLength: bin.length}], bufferViews,
    accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3'}, {bufferView: 1, componentType: 5125, count: 3, type: 'SCALAR'},
      ...(normals ? [{bufferView: 2, componentType: 5126, count: 3, type: 'VEC3'}] : [])]};
  const text = new TextEncoder().encode(JSON.stringify(json)), tl = Math.ceil(text.length / 4) * 4, out = new Uint8Array(28 + tl + bin.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true); dv.setUint32(12, tl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + tl); out.set(text, 20); dv.setUint32(20 + tl, bin.length, true); dv.setUint32(24 + tl, 0x004e4942, true); out.set(bin, 28 + tl);
  return Buffer.from(out);
}
const glbJSON = bytes => JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());

// Stand-in Kaminos server: serves the hero, lists `levels`, stores and registers, recording calls.
async function standIn({hero, levels = []}) {
  const {createServer} = await import('node:http'), {createHash} = await import('node:crypto');
  const calls = [], registered = [], stored = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    calls.push(`${req.method} ${req.url.split('?')[0]}`);
    const json = value => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value)); };
    if (req.url.startsWith('/api/read')) { res.writeHead(200); res.end(hero); return; }
    if (req.method === 'GET' && req.url.startsWith('/api/mesh-lods')) return json({levels});
    if (req.url.startsWith('/api/ingest-mesh')) { stored.push(body); return json({sha256: createHash('sha256').update(body).digest('hex')}); }
    if (req.method === 'POST' && req.url.startsWith('/api/mesh-lods')) { const r = JSON.parse(body); registered.push(r); return json({schema: 'kaminos.lod-set.v0', source: r.source, level: r.level, retired: []}); }
    res.writeHead(500); res.end('unexpected');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {url: `http://127.0.0.1:${server.address().port}`, calls, registered, stored, close: () => server.close()};
}
function triangleInput() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-tool-'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({materialResolution: 4}));
  const coords = [], feats = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { coords.push(i, j, 0); feats.push(0.2, 0, 0, 0, 0.6, 1); }
  for (const [n, a] of [['vertices.f32', new Float32Array([0,0,0, 1,0,0, 0,1,0])], ['triangles.u32', new Uint32Array([0,1,2])],
    ['material.features.f32', new Float32Array(feats)], ['material.coordinates.i32', new Int32Array(coords)]]) fs.writeFileSync(path.join(dir, n), Buffer.from(a.buffer));
  return dir;
}
async function runTool(args) {
  const {spawn} = await import('node:child_process');
  const child = spawn(process.execPath, [tool, ...args], {stdio: 'ignore'});
  return new Promise(r => child.on('exit', r));
}

test('error is measured against the hero; an off-target tier publishes under its actual faces', async () => {
  const server = await standIn({hero: triangleGLB()}), dir = triangleInput(), report = path.join(dir, 'report.json');
  const status = await runTool(['--input', dir, '--source', 'a'.repeat(64), '--server', server.url, '--targets', '200', '--report', report]);
  server.close();
  const r = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(status, 0, JSON.stringify(r.error));
  assert.equal(r.phase, 'done');
  assert.equal(server.registered.length, 1);
  const level = server.registered[0].level;
  assert.notEqual(level.faces, 200, 'this input lands off its 200-face target');
  assert.equal(level.faces, r.tiers[0].faces, 'registered under the faces it actually has');
  assert.deepEqual(level.error.reference, {kind: 'hero', sha256: 'a'.repeat(64), faces: 1});
  assert.equal(level.errorAgainstRawDecode.reference.kind, 'raw-decode');
  assert.match(level.errorAgainstRawDecode.reference.digests['vertices.f32'], /^[a-f0-9]{64}$/);
  assert.equal(server.registered[0].supersede, false);
  // By default every tier carries a normal map baked from the hero, and the record says so.
  assert.deepEqual({...level.normalMap, reach: undefined}, {source: {kind: 'hero', sha256: 'a'.repeat(64)}, textureSize: level.textureSize, sampler: 'ray-along-level-normal+texel-footprint', reach: undefined});
  assert.ok(level.normalMap.reach >= 0 && Math.abs(level.normalMap.reach - 1.25 * level.error.levelToSource.max) < 1e-12, 'reach follows the measured level-to-hero distance');
  const published = glbJSON(server.stored[0]);
  assert.ok(published.materials[0].normalTexture, 'published GLB has a normal map');
  assert.ok(published.meshes[0].primitives[0].attributes.TANGENT !== undefined);
  assert.equal(published.extras.lodNormalMap.source.kind, 'hero');
  assert.match(published.extras.lodNormalMap.method, /^ray along the level normal/);
});

test('a hero without shading normals is refused before anything is stored, unless normal maps are off', async () => {
  for (const off of [false, true]) {
    const server = await standIn({hero: triangleGLB(0, {normals: false})}), dir = triangleInput(), report = path.join(dir, 'report.json');
    const status = await runTool(['--input', dir, '--source', 'a'.repeat(64), '--server', server.url, '--targets', '200', '--report', report, ...(off ? ['--normal-maps', 'false'] : [])]);
    server.close();
    const r = JSON.parse(fs.readFileSync(report, 'utf8'));
    if (off) {
      assert.equal(status, 0, JSON.stringify(r.error));
      assert.equal(server.registered[0].level.normalMap, undefined);
      assert.equal(glbJSON(server.stored[0]).materials[0].normalTexture, undefined);
    } else {
      assert.notEqual(status, 0);
      assert.equal(r.phase, 'normal-map');
      assert.match(r.error.message, /hero has no shading normals/);
      assert.ok(!server.calls.some(c => c.startsWith('POST')), `nothing stored: ${server.calls}`);
    }
  }
});

test('a hero in another frame is refused before anything is stored', async () => {
  const server = await standIn({hero: triangleGLB(100)}), dir = triangleInput(), report = path.join(dir, 'report.json');
  const status = await runTool(['--input', dir, '--source', 'a'.repeat(64), '--server', server.url, '--targets', '200', '--report', report]);
  server.close();
  const r = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.notEqual(status, 0);
  assert.equal(r.phase, 'frame-check');
  assert.ok(!server.calls.some(c => c.startsWith('POST')), `nothing stored: ${server.calls}`);
});

test('--replace true supersedes a taken slot instead of refusing it', async () => {
  const taken = [{sha256: 'b'.repeat(64), faces: 200, route: 'closed-remesh+projection+trellis-simplify'}];
  const server = await standIn({hero: triangleGLB(), levels: taken}), dir = triangleInput(), report = path.join(dir, 'report.json');
  const status = await runTool(['--input', dir, '--source', 'a'.repeat(64), '--server', server.url, '--targets', '200', '--replace', 'true', '--report', report]);
  server.close();
  assert.equal(status, 0);
  assert.equal(server.registered[0].supersede, true);
});
