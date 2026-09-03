#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const witness = readFileSync(resolve(root, 'volume-settings-preset-witness.mjs'), 'utf8');
const cockpit = readFileSync(resolve(root, 'index.html'), 'utf8');
const server = readFileSync(resolve(root, 'serve.py'), 'utf8');

assert.match(
  cockpit,
  /id="basin-promotion-root"[^>]*value="~\/\.local\/share\/kaminos\/basin-promotions"/,
  'cockpit Export must default to a caller-owned durable package root',
);
assert.match(
  server,
  /Path\(promotion_root\)\.expanduser\(\)/,
  'the server must expand the portable home-relative promotion root before invoking the shared exporter',
);

assert.match(witness, /--promotion-root/, 'cockpit witness must accept a caller-selected durable promotion root');
assert.match(witness, /--promotion-handle/, 'cockpit witness must pin the stable human handle');
assert.match(
  witness,
  /__kaminosExportBasinPromotionPackage/,
  'cockpit witness must invoke the same export action exposed to the operator',
);
assert.match(witness, /promotionReceipt/, 'cockpit witness must preserve the returned package and channel receipt');
assert.match(witness, /basin-promotion-write-receipt\.v1/, 'cockpit witness must reject stale export schemas');

console.log('volume basin promotion cockpit witness contracts passed');
