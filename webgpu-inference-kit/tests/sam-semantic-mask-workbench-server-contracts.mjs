import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

console.log('sam semantic mask workbench server contracts passed');
