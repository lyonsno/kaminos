import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const driver = new URL('../tools/sam31-two-frame-tracker-browser-parity-smoke.mjs', import.meta.url);
const packetDir = await mkdtemp(join(tmpdir(), 'sam31-two-frame-authority-'));
const reportPath = join(packetDir, 'report.json');
const reference = {
  model: { id: 'facebook/sam3.1', revision: 'daa63191845a41281374e725f4c9e51c7a824460', sha256: 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6' },
  source: { repository: 'facebookresearch/sam3', commit: '5dd401d1c5c1d5c3eedff06d41b77af824517619', workingTreeClean: true },
};

async function writePacket(name) {
  const directory = join(packetDir, name);
  await mkdir(directory, { recursive: true });
  const manifestText = `${JSON.stringify({ schema: `test.${name}.manifest.v0`, boundary: `${name}-boundary`, reference }, null, 2)}\n`;
  const digest = `sha256:${createHash('sha256').update(manifestText).digest('hex')}`;
  await writeFile(join(directory, 'tensor-manifest.json'), manifestText);
  await writeFile(join(directory, 'reference-receipt.json'), `${JSON.stringify({
    ok: true,
    schema: `test.${name}.receipt.v0`,
    boundary: `${name}-boundary`,
    reference,
    outputs: { tensorManifest: join(directory, 'tensor-manifest.json'), tensorManifestSha256: digest },
  }, null, 2)}\n`);
}

for (const name of ['decoder', 'memory', 'temporal', 'episode']) await writePacket(name);

function verifyOnly(report) {
  return spawnSync(process.execPath, [driver.pathname,
    '--packet-dir', packetDir,
    '--report', report,
    '--reuse-packet', '1',
    '--verify-only', '1',
    '--debug-port', String(20000 + process.pid % 10000),
    '--server-port', String(30000 + process.pid % 10000),
    '--timeout-ms', '1000',
  ], { cwd: root.pathname, encoding: 'utf8', timeout: 10000 });
}

const valid = verifyOnly(reportPath);
assert.equal(valid.status, 0, valid.stderr || valid.stdout);
const validReport = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(validReport.ok, true);
assert.equal(validReport.packetAuthority.passed, true);
assert.deepEqual(validReport.packetAuthority.verifiedPackets, ['decoder', 'memory', 'temporal', 'episode']);
assert.equal(validReport.primary_output_written, false, 'authority-only verification must not pretend to write browser evidence');

await writeFile(join(packetDir, 'memory', 'tensor-manifest.json'), '{"tampered":true}\n');
const tamperedReportPath = join(packetDir, 'tampered-report.json');
const tampered = verifyOnly(tamperedReportPath);
assert.notEqual(tampered.status, 0, 'the composed witness must reject a manifest changed after its reference receipt was written');
const tamperedReport = JSON.parse(await readFile(tamperedReportPath, 'utf8'));
assert.equal(tamperedReport.ok, false);
assert.equal(tamperedReport.failure_phase, 'verify_packet_authority');
assert.match(tamperedReport.error, /memory manifest digest mismatch/);
assert.equal(tamperedReport.primary_output_written, false);

console.log('sam3.1 two-frame tracker driver authority contracts passed');
