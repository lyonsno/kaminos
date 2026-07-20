#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const handle = 'big-raymarch-hero-flamebowl-cotangent-covariance';
const basinRoot = resolve(root, 'artifacts', 'basin-promotions', handle);
const channelPath = resolve(basinRoot, 'current.json');
const channel = JSON.parse(readFileSync(channelPath, 'utf8'));
const packagePath = resolve(dirname(channelPath), channel.current.packageRelativePath);
const packageBytes = readFileSync(packagePath);
const packageDocument = JSON.parse(packageBytes);
const controls = packageDocument.settingsPreset.artifact.preset.domControls;

assert.equal(channel.history.length, 2, 'iteration channel must retain revision one and current revision two');
assert.notEqual(channel.history[0].revision, channel.current.revision, 'revision two must not overwrite revision one');
assert.equal(packageDocument.stableRef, channel.current.stableRef);
assert.equal(createHash('sha256').update(packageBytes).digest('hex'), channel.current.packageSha256);
assert.equal(packageDocument.sourceCommit, 'dcf2ee18a8ed726efde5bf2ae4a8e0f8cd804c10');
assert.equal(packageDocument.effectiveState.simulator.grid, 128);
assert.equal(packageDocument.effectiveState.renderer.raySteps, 130);
assert.equal(packageDocument.effectiveState.renderer.adaptiveRays, 0.5);
assert.equal(packageDocument.effectiveState.renderer.renderScale, 0.25);
assert.equal(controls['volume-resolution'].value, '128');
assert.equal(controls['volume-steps'].value, 130);
assert.equal(controls['volume-adaptive-rays'].value, 0.5);
assert.equal(controls['volume-render-scale'].value, 0.25);

console.log(`volume basin promotion iteration revision verified: ${packageDocument.stableRef}`);
