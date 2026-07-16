import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const server = readFileSync(new URL('../tools/sam-semantic-mask-workbench-server.mjs', import.meta.url), 'utf8');

for (const argument of ['kit-root', 'packet-root', 'sample-root', 'host', 'port', 'receipt', 'commit']) {
  assert.match(server, new RegExp(`['"]${argument}['"]`), `server must expose --${argument}`);
}
assert.match(server, /packet-root[^]*required/, 'packet root must be caller-owned and required');
assert.match(server, /sample-root[^]*required/, 'sample root must be caller-owned and required');
assert.match(server, /\/api\/sam3-workbench-route/, 'server must expose route registration evidence');
assert.match(server, /requestedRoute/, 'registration receipt must preserve the requested operator route');
assert.match(server, /effectiveRoute/, 'registration receipt must preserve the effective operator route');
assert.match(server, /registrationState:\s*['"]mounted['"]/, 'registration receipt must state successful mount authority');
assert.match(server, /manifestSha256/, 'registration receipt must authenticate the effective packet manifest');
assert.match(server, /git[^]*rev-parse[^]*HEAD/, 'registration receipt must derive the effective tracked commit from the mounted kit checkout');
assert.match(server, /requested commit[^]*does not match[^]*tracked commit/i, 'an explicitly requested stale commit must fail before route registration');
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
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: 'SAM Workbench Contract',
  GIT_AUTHOR_EMAIL: 'sam-workbench@example.invalid',
  GIT_COMMITTER_NAME: 'SAM Workbench Contract',
  GIT_COMMITTER_EMAIL: 'sam-workbench@example.invalid',
};
for (const args of [['init', '--quiet'], ['commit', '--allow-empty', '--quiet', '-m', 'fixture']]) {
  const result = spawnSync('git', args, { cwd: kitRoot, env: gitEnvironment, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}
const trackedCommitResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: kitRoot, env: gitEnvironment, encoding: 'utf8' });
assert.equal(trackedCommitResult.status, 0);
const trackedCommit = trackedCommitResult.stdout.trim();
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
      const response = await fetch(`http://127.0.0.1:${port}/api/sam3-workbench-route`);
      if (response.ok) {
        const route = await response.json();
        assert.equal(route.commit, trackedCommit, 'route registration must expose the effective tracked kit commit');
        break;
      }
    } catch {}
    if (Date.now() > deadline) throw new Error('workbench server contract fixture did not start');
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  }
  const escape = await fetch(`http://127.0.0.1:${port}/sam3-samples/escape.txt`);
  assert.equal(escape.status, 403, 'symlinked files escaping a declared mount must fail closed');

  const stalePortProbe = createServer();
  await new Promise(resolveListen => stalePortProbe.listen(0, '127.0.0.1', resolveListen));
  const { port: stalePort } = stalePortProbe.address();
  await new Promise(resolveClose => stalePortProbe.close(resolveClose));
  let staleStderr = '';
  const staleChild = spawn(process.execPath, [
    serverPath,
    '--kit-root', kitRoot,
    '--packet-root', packetRoot,
    '--sample-root', sampleRoot,
    '--port', String(stalePort),
    '--commit', '0000000000000000000000000000000000000000',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  staleChild.stderr.on('data', chunk => { staleStderr += chunk.toString(); });
  const staleExit = await Promise.race([
    new Promise(resolveExit => staleChild.once('exit', (code, signal) => resolveExit({ code, signal }))),
    new Promise(resolveTimeout => setTimeout(() => resolveTimeout(null), 1_000)),
  ]);
  if (!staleExit) staleChild.kill('SIGTERM');
  assert.notEqual(staleExit, null, 'server must refuse a stale requested commit before it starts listening');
  assert.notEqual(staleExit.code, 0, 'stale requested commit must exit unsuccessfully');
  assert.match(staleStderr, /requested commit[^]*does not match[^]*tracked commit/i);
} finally {
  child.kill('SIGTERM');
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('sam semantic mask workbench server contracts passed');
