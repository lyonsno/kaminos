#!/usr/bin/env node
import assert from 'node:assert/strict';
import { installVolumeRuntimeForwarders } from '../volume-selective-head-wrapper-runtime.mjs';

const wrapperWindow = {};
const basin = { contentWindow: null };
const receipt = installVolumeRuntimeForwarders(wrapperWindow, basin);

assert.equal(receipt.identity, 'exact-same-origin-volume-runtime-forwarders-v0');
assert.equal(wrapperWindow.__kaminosVolumePrototype, null, 'prototype forwarding stays empty before the basin runtime exists');
assert.equal(wrapperWindow.__kaminosVolumeBridge, null, 'bridge forwarding stays empty before the basin runtime exists');

const firstPrototype = { identity: 'first-prototype' };
const firstBridge = { identity: 'first-bridge' };
basin.contentWindow = {
  __kaminosVolumePrototype: firstPrototype,
  __kaminosVolumeBridge: firstBridge,
};
assert.equal(wrapperWindow.__kaminosVolumePrototype, firstPrototype, 'prototype forwarding returns the exact live basin object');
assert.equal(wrapperWindow.__kaminosVolumeBridge, firstBridge, 'bridge forwarding returns the exact live basin object');

const replacementPrototype = { identity: 'replacement-prototype' };
const replacementBridge = { identity: 'replacement-bridge' };
basin.contentWindow = {
  __kaminosVolumePrototype: replacementPrototype,
  __kaminosVolumeBridge: replacementBridge,
};
assert.equal(wrapperWindow.__kaminosVolumePrototype, replacementPrototype, 'prototype forwarding follows iframe replacement instead of retaining stale authority');
assert.equal(wrapperWindow.__kaminosVolumeBridge, replacementBridge, 'bridge forwarding follows iframe replacement instead of retaining stale authority');

basin.contentWindow = null;
assert.equal(wrapperWindow.__kaminosVolumePrototype, null, 'prototype forwarding fails empty after basin detachment');
assert.equal(wrapperWindow.__kaminosVolumeBridge, null, 'bridge forwarding fails empty after basin detachment');

console.log('selective-head wrapper runtime contracts passed');
