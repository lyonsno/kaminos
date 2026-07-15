import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const server = readFileSync(new URL('../tools/sam-semantic-mask-workbench-server.mjs', import.meta.url), 'utf8');

for (const argument of ['kit-root', 'packet-root', 'sample-root', 'host', 'port', 'receipt']) {
  assert.match(server, new RegExp(`['"]${argument}['"]`), `server must expose --${argument}`);
}
assert.match(server, /packet-root[^]*required/, 'packet root must be caller-owned and required');
assert.match(server, /sample-root[^]*required/, 'sample root must be caller-owned and required');
assert.match(server, /\/api\/sam3-workbench-route/, 'server must expose route registration evidence');
assert.match(server, /requestedRoute/, 'registration receipt must preserve the requested operator route');
assert.match(server, /effectiveRoute/, 'registration receipt must preserve the effective operator route');
assert.match(server, /registrationState:\s*['"]mounted['"]/, 'registration receipt must state successful mount authority');
assert.match(server, /manifestSha256/, 'registration receipt must authenticate the effective packet manifest');
assert.match(server, /workbench-packet/, 'server must mount the reusable model packet separately');
assert.match(server, /sam3-samples/, 'server must mount operator sample images separately');
assert.match(server, /cross-origin-opener-policy/, 'server must preserve browser GPU isolation headers');
assert.match(server, /startsWith\(`\$\{root\}\//, 'server must reject path traversal outside every mount root');
assert.match(server, /realpathSync\(filePath\)/, 'server must resolve a requested file before mount containment and read');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'sam-workbench-server-contract-'));
const kitRoot = join(fixtureRoot, 'kit');
const packetRoot = join(fixtureRoot, 'packet');
const sampleRoot = join(fixtureRoot, 'samples');
mkdirSync(kitRoot);
mkdirSync(packetRoot);
mkdirSync(sampleRoot);
writeFileSync(join(packetRoot, 'tensor-manifest.json'), '{}\n');
for (const sample of ['truck.jpg', 'groceries.jpg', 'test_image.jpg']) writeFileSync(join(sampleRoot, sample), sample);
const outsideFile = join(fixtureRoot, 'outside-secret.txt');
writeFileSync(outsideFile, 'must not be served\n');
symlinkSync(outsideFile, join(sampleRoot, 'escape.txt'));

const portProbe = createServer();
await new Promise(resolveListen => portProbe.listen(0, '127.0.0.1', resolveListen));
const { port } = portProbe.address();
await new Promise(resolveClose => portProbe.close(resolveClose));

const serverPath = new URL('../tools/sam-semantic-mask-workbench-server.mjs', import.meta.url).pathname;
const child = spawn(process.execPath, [
  serverPath,
  '--kit-root', kitRoot,
  '--packet-root', packetRoot,
  '--sample-root', sampleRoot,
  '--port', String(port),
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      const route = await fetch(`http://127.0.0.1:${port}/api/sam3-workbench-route`);
      if (route.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error('workbench server contract fixture did not start');
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  }
  const escape = await fetch(`http://127.0.0.1:${port}/sam3-samples/escape.txt`);
  assert.equal(escape.status, 403, 'symlinked files escaping a declared mount must fail closed');
} finally {
  child.kill('SIGTERM');
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('sam semantic mask workbench server contracts passed');
