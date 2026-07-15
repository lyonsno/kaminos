import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const fixtureDir = mkdtempSync(join(tmpdir(), 'kaminos-stage-download-'));
const audioPath = join(fixtureDir, 'source.wav');
spawnSync('ffmpeg', [
  '-v', 'error',
  '-f', 'lavfi',
  '-i', 'sine=frequency=220:sample_rate=8000:duration=1',
  '-ac', '1',
  '-c:a', 'pcm_s16le',
  audioPath,
], { encoding: 'utf8' });

const serverScript = String.raw`
  const http = require('node:http');
  const fs = require('node:fs');
  const audio = fs.readFileSync(process.argv[1]);
  const server = http.createServer((request, response) => {
    if (request.url === '/source') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<a href="/audio">audio</a>');
      return;
    }
    if (request.url === '/html') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>not audio</title>');
      return;
    }
    const validReferer = request.headers.referer?.endsWith('/source');
    const validAgent = /Mozilla/.test(request.headers['user-agent'] || '');
    if (request.url !== '/audio' || !validReferer || !validAgent) {
      response.writeHead(403, { 'content-type': 'text/plain' });
      response.end('forbidden');
      return;
    }
    response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length });
    response.end(audio);
  });
  server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;
const server = spawn(process.execPath, ['-e', serverScript, audioPath], { stdio: ['ignore', 'pipe', 'inherit'] });
const chunks = [];
let port;
server.stdout.on('data', chunk => {
  chunks.push(chunk);
  const match = Buffer.concat(chunks).toString('utf8').match(/^(\d+)/);
  if (match) port = Number(match[1]);
});
while (!port) await once(server.stdout, 'data');

try {
  const base = `http://127.0.0.1:${port}`;
  const cachePath = join(fixtureDir, 'cached.wav');
  const reportPath = join(fixtureDir, 'download-report.json');
  const run = spawnSync(process.execPath, [
    'stage-atoms-witness.mjs',
    '--fixture', 'ccmixter-geppetto',
    '--download-url', `${base}/audio`,
    '--source-page-url', `${base}/source`,
    '--cache-file', cachePath,
    '--output', reportPath,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.ok(report.lastTrustworthyEvidence.downloadReceipt, 'download receipt must name effective transport authority');
  assert.equal(report.lastTrustworthyEvidence.downloadReceipt.requestedUrl, `${base}/audio`);
  assert.equal(report.lastTrustworthyEvidence.downloadReceipt.effectiveUrl, `${base}/audio`);
  assert.equal(report.lastTrustworthyEvidence.downloadReceipt.sourcePageUrl, `${base}/source`);
  assert.equal(report.lastTrustworthyEvidence.downloadReceipt.statusCode, 200);
  assert.equal(report.lastTrustworthyEvidence.downloadReceipt.contentType, 'audio/wav');
  assert.equal(report.lastTrustworthyEvidence.downloadReceipt.authority, 'source-page-referred-download');
  assert.equal(report.lastTrustworthyEvidence.audioInput.effectivePath, cachePath);
  assert.equal(readFileSync(cachePath).byteLength, readFileSync(audioPath).byteLength);
  assert.ok(
    !report.witness.stage.sourceAccess.receiptWarnings.includes('direct_mp3_probe_returned_403_use_ccmixter_page_or_download_flow'),
    'verified source-page-referred download must clear the superseded direct-probe warning',
  );

  const decoyReportPath = join(fixtureDir, 'decoy-report.json');
  const decoyRun = spawnSync(process.execPath, [
    'stage-atoms-witness.mjs',
    '--fixture', 'ccmixter-geppetto',
    '--download-url', `${base}/html`,
    '--source-page-url', `${base}/source`,
    '--cache-file', join(fixtureDir, 'decoy.mp3'),
    '--output', decoyReportPath,
  ], { cwd: root, encoding: 'utf8' });
  assert.notEqual(decoyRun.status, 0, '200-OK HTML must not become audio evidence');
  const decoyReport = JSON.parse(readFileSync(decoyReportPath, 'utf8'));
  assert.equal(decoyReport.failurePhase, 'audio_download');
  assert.equal(decoyReport.lastTrustworthyEvidence.downloadReceipt.statusCode, 200);
  assert.equal(decoyReport.lastTrustworthyEvidence.downloadReceipt.contentType, 'text/html');
  assert.equal(decoyReport.lastTrustworthyEvidence.audioInput, null);
} finally {
  server.kill('SIGTERM');
}

console.log('stage audio download contracts passed');
