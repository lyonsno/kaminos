import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witnessPath = join(root, 'smoke-bench-native-host-witness.mjs');
const fixturePath = join(root, 'fixtures/smoke-bench-native-host/glove-well-native-host-fixture.json');
const passOut = '/tmp/kaminos-smoke-bench-native-host-pass.json';
const failFixture = '/tmp/kaminos-smoke-bench-native-host-fail-fixture.json';
const failOut = '/tmp/kaminos-smoke-bench-native-host-fail.json';

assert.ok(existsSync(witnessPath), 'native-host witness CLI exists');
assert.ok(existsSync(fixturePath), 'Glove Well native-host fixture exists');

execFileSync('node', [witnessPath, '--fixture', fixturePath, '--out', passOut], {
  cwd: root,
  stdio: 'pipe',
});
const passReport = JSON.parse(readFileSync(passOut, 'utf8'));
assert.equal(passReport.schema, 'kaminos.smoke-bench.native-host-witness-report.v0');
assert.equal(passReport.ok, true);
assert.equal(passReport.report.schema, 'kaminos.smoke-bench.native-host-conformance.v0');
assert.equal(passReport.report.ok, true);
assert.equal(passReport.report.effective.adapterId, 'glove-well');
assert.equal(passReport.report.effective.packetSchema, 'lerms.glove-well-host-packet.v0');
assert.equal(passReport.report.primitiveRoleCounts.lerm_desire_link, 5);

const badFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
badFixture.adapterState.packetSchema = 'lerms.bad-proxy-packet.v0';
writeFileSync(failFixture, `${JSON.stringify(badFixture, null, 2)}\n`);
let failed = false;
try {
  execFileSync('node', [witnessPath, '--fixture', failFixture, '--out', failOut], {
    cwd: root,
    stdio: 'pipe',
  });
} catch {
  failed = true;
}
assert.equal(failed, true, 'native-host witness exits nonzero when packet identity is wrong');
const failReport = JSON.parse(readFileSync(failOut, 'utf8'));
assert.equal(failReport.schema, 'kaminos.smoke-bench.native-host-witness-report.v0');
assert.equal(failReport.ok, false);
assert.ok(
  failReport.report.violations.some(item => /packet schema/i.test(item)),
  'failure report records wrong effective packet schema',
);
