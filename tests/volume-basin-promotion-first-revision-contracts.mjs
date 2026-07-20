#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateBasinPromotionPackage } from '../volume-basin-promotion-package.mjs';

const root = resolve(import.meta.dirname, '..');
const handle = 'big-raymarch-hero-flamebowl-cotangent-covariance';
const basinRoot = resolve(root, 'artifacts', 'basin-promotions', handle);
const channelPath = resolve(basinRoot, 'current.json');
const receiptPath = resolve(basinRoot, 'receipt.json');
const channel = JSON.parse(readFileSync(channelPath, 'utf8'));
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const packagePath = resolve(dirname(channelPath), channel.current.packageRelativePath);

assert.equal(channel.schema, 'kaminos.volume.basin-promotion-channel.v1');
assert.equal(channel.handle, handle);
assert.equal(channel.history.length, 1, 'first promoted handle must contain one accepted revision');
assert.ok(existsSync(packagePath), 'current channel package must exist in the repository');

const packageBytes = readFileSync(packagePath);
const packageDocument = validateBasinPromotionPackage(JSON.parse(packageBytes));
const packageSha256 = createHash('sha256').update(packageBytes).digest('hex');
assert.equal(packageSha256, channel.current.packageSha256);
assert.equal(packageDocument.revision, channel.current.revision);
assert.equal(packageDocument.stableRef, channel.current.stableRef);
assert.equal(packageDocument.sourceCommit, channel.current.sourceCommit);
assert.equal(packageDocument.settingsPreset.presetId, receipt.source.settingsPresetId);
assert.equal(packageDocument.effectiveState.renderer.fallbackReason, null);
assert.equal(packageDocument.effectiveState.composition.fallbackReason, null);

assert.equal(receipt.schema, 'kaminos.volume.basin-promotion-receipt.v1');
assert.equal(receipt.status, 'cockpit-exported-and-exact-mounted');
assert.equal(receipt.revision, packageDocument.revision);
assert.equal(receipt.package.relativePath, channel.current.packageRelativePath);
assert.equal(receipt.package.sha256, packageSha256);
assert.equal(receipt.source.kaminosCommit, packageDocument.sourceCommit);
assert.ok(existsSync(resolve(basinRoot, receipt.source.loaderWitness)), 'receipt source witness must resolve');

for (const [label, document] of [['package', packageDocument], ['channel', channel], ['receipt', receipt]]) {
  const serialized = JSON.stringify(document);
  assert.equal(serialized.includes('/private/tmp/'), false, `${label} must not embed a temporary checkout path`);
  assert.equal(serialized.includes('/Users/'), false, `${label} must not embed an author home path`);
}

console.log('volume basin promotion first revision contracts passed');
