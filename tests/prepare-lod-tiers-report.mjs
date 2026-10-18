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
