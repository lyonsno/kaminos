import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /id="compute-route-fire-actuator"/, 'Volume tab hosts the actuated compute route panel');
assert.match(index, /data-compute-route-fire-actuator-schema="kaminos\.compute-route-fire-actuator\.v0"/, 'actuator panel preserves schema identity');
assert.match(index, /id="compute-route-fire-start"/, 'operator has an explicit control to start SHARP');
assert.match(index, /id="compute-route-fire-input-path"/, 'operator can see or edit the route input path');
assert.match(index, /id="compute-route-fire-run-status"/, 'operator sees running/completed/failed status');
assert.match(index, /id="compute-route-fire-run-report"/, 'operator sees the report path after completion');
assert.match(index, /id="compute-route-fire-run-artifacts"/, 'operator sees output artifacts after completion');
assert.match(index, /startComputeRouteFireRun/, 'browser owns an actuator start function');
assert.match(index, /pollComputeRouteFireRun/, 'browser polls live route status instead of replaying a completed run');
assert.match(index, /\/api\/compute-route-fire\/start/, 'browser starts the route through the Kaminos server API');
assert.match(index, /\/api\/compute-route-fire\/status/, 'browser polls route state through the Kaminos server API');
assert.match(index, /volumePrototype\.setActive\(true\)/, 'browser starts fire while the route is running');
assert.match(index, /volumePrototype\.setActive\(false\)/, 'browser stops fire after completion or failure');
assert.doesNotMatch(index, /Start SHARP[\s\S]{0,120}smokePayload/, 'actuator control must not be wired to smoke-payload replay');
