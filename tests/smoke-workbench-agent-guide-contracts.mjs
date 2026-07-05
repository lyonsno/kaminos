import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const kilnDoc = readFileSync(join(root, 'docs', 'spatial-asset-kiln.md'), 'utf8');
const guidePath = join(root, 'docs', 'smoke-workbench-for-agents.md');

assert.ok(existsSync(guidePath), 'Kaminos ships an agent-facing Smoke Workbench guide');

const guide = readFileSync(guidePath, 'utf8');

assert.match(readme, /\[Smoke Workbench For Agents\]\(docs\/smoke-workbench-for-agents\.md\)/, 'README links the agent smoke guide');
assert.match(kilnDoc, /\[Smoke Workbench For Agents\]\(smoke-workbench-for-agents\.md\)/, 'Spatial Asset Kiln doc points agents to the guide');
assert.match(guide, /Kaminos is the smoke-making toolkit/i, 'guide centers the happy path around Kaminos as tooling');
assert.match(guide, /Do not send the operator a lane-local demo as the smoke/i, 'guide rejects local demo handoff as the normal path');
assert.match(guide, /Minimum deliverable/i, 'guide names the current minimum deliverable');
assert.match(guide, /Tooling target/i, 'guide separates near-term manual steps from future tooling');
assert.match(guide, /single visual asset/i, 'guide covers simple asset smoke links as first-class Kaminos routes');
assert.match(guide, /operator route/i, 'guide requires the same route the operator will use');
assert.match(guide, /visual witness/i, 'guide requires visual witness evidence for operator smoke');

console.log('smoke workbench agent guide contracts passed');
