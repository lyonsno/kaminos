import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const executeFile = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputPath = process.env.PARITY_BROWSER_SMOKE_OUTPUT
  || '/tmp/webgpu-inference-kit-parity-browser-smoke.json';
const requestedPath = '/tests/parity-primitives-browser-smoke.html';

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeReport(report) {
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, 'http://127.0.0.1').pathname;
  const relativePath = requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(packageRoot, relativePath);
  if (filePath !== packageRoot && !filePath.startsWith(`${packageRoot}${path.sep}`)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = fs.readFileSync(filePath);
    const contentType = filePath.endsWith('.js') || filePath.endsWith('.mjs')
      ? 'text/javascript'
      : (filePath.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' }).end(body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
  }
});

let report = {
  schema: 'kaminos.webgpu-parity-browser-smoke.v0',
  status: 'failed',
  requestedRoute: null,
  effectiveRoute: null,
  requestedModule: 'src/index.js',
  effectiveModule: null,
  sourceSha256: {
    index: sha256File(path.join(packageRoot, 'src/index.js')),
    parityPrimitives: sha256File(path.join(packageRoot, 'src/parity-primitives.js')),
  },
  browserPath: chromePath,
  failurePhase: 'setup',
  lastTrustworthyEvidence: 'source files hashed',
  browserResult: null,
  error: null,
};

try {
  if (!fs.existsSync(chromePath)) throw new Error(`Chrome executable not found: ${chromePath}`);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const requestedRoute = `http://127.0.0.1:${address.port}${requestedPath}`;
  report = {
    ...report,
    requestedRoute,
    failurePhase: 'chrome-execution',
    lastTrustworthyEvidence: 'exact local route listening',
  };
  const { stdout, stderr } = await executeFile(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--dump-dom',
    '--virtual-time-budget=5000',
    requestedRoute,
  ], { maxBuffer: 8 * 1024 * 1024 });
  const encodedMatch = stdout.match(/data-parity-smoke="([^"]+)"/);
  if (!encodedMatch) throw new Error(`browser result missing or blank; stderr=${stderr.trim()}`);
  const browserResult = JSON.parse(Buffer.from(encodedMatch[1], 'base64').toString('utf8'));
  if (browserResult.status !== 'succeeded') {
    throw new Error(`browser exercise failed: ${browserResult.error?.message || 'unknown error'}`);
  }
  assert.equal(browserResult.requestedModuleUrl, browserResult.effectiveModuleUrl);
  assert.equal(browserResult.runId, 'kaminos-parity-browser-smoke');
  assert.equal(browserResult.stageId, 'decoder.fusion');
  assert.equal(browserResult.chunkCount, 4);
  assert.deepEqual(browserResult.values, [1, 2, 3, 5]);
  assert.equal(browserResult.comparison.sourceElementCount, 4);
  assert.equal(browserResult.comparison.comparedElementCount, 4);
  assert.match(browserResult.tensorSha256, /^[a-f0-9]{64}$/);
  assert.match(browserResult.captureSha256, /^[a-f0-9]{64}$/);
  report = {
    ...report,
    status: 'succeeded',
    effectiveRoute: requestedRoute,
    effectiveModule: 'src/index.js',
    failurePhase: null,
    lastTrustworthyEvidence: 'comparison serialized after verified chunk round trip',
    browserResult,
    error: null,
  };
  writeReport(report);
  console.log(`parity primitive browser smoke passed: ${outputPath}`);
} catch (error) {
  report = {
    ...report,
    status: 'failed',
    error: { name: error.name, message: error.message, stack: error.stack },
  };
  writeReport(report);
  throw error;
} finally {
  await new Promise(resolve => server.close(resolve));
}
