import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { countChangedVisibleWaterPixels, countVisibleWaterPixels } from '../screenshot-png-rgb.mjs';

const root = new URL('..', import.meta.url).pathname;
const witness = readFileSync(join(root, 'scene-object-witness.mjs'), 'utf8');

test('local-liquid live witness requires a new matched host/solver frame and visible pixels', () => {
  assert.ok(/firstFrameCount/.test(witness), 'witness must prove host frame count advances during the observation interval');
  assert.ok(/hostFrameId/.test(witness), 'witness must match the final submitted host frame to solver encode evidence');
  assert.ok(/visibleWaterPixelCount/.test(witness), 'witness must inspect captured canvas pixels rather than host-owned success flags');
  assert.ok(/visibleWaterChangedPixelCount/.test(witness), 'witness must distinguish advancing liquid pixels from stationary cyan support geometry');
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function rgbPng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.from([0]), pixels.subarray(y * width * 3, (y + 1) * width * 3));
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('canvas pixel check rejects blank and host-only neutral frames while accepting visible cyan water', () => {
  const cyan = [110,205,232], basin = [165,178,179], black = [0,0,0];
  const visible = Buffer.from([...cyan,...cyan,...basin, ...black,...cyan,...basin]);
  const pixels = countVisibleWaterPixels({png:rgbPng(3,2,visible),bounds:{x:0,y:0,width:3,height:2},viewportWidth:3,viewportHeight:2,minimumPixels:3});
  assert.equal(pixels.visibleWaterPixelCount, 3);
  const blank = Buffer.from(Array(3*2*3).fill(0));
  assert.equal(countVisibleWaterPixels({png:rgbPng(3,2,blank),bounds:{x:0,y:0,width:3,height:2},viewportWidth:3,viewportHeight:2}).visibleWaterPixelCount, 0);
  const hostOnly = Buffer.from([...basin,...basin,...basin, ...basin,...basin,...basin]);
  assert.equal(countVisibleWaterPixels({png:rgbPng(3,2,hostOnly),bounds:{x:0,y:0,width:3,height:2},viewportWidth:3,viewportHeight:2}).visibleWaterPixelCount, 0);
});

test('temporal water witness rejects a stationary cyan basin that passes the old pixel threshold', () => {
  const cyan = [110,205,232], black = [0,0,0];
  const staticBasin = Buffer.from([...cyan,...cyan,...cyan, ...cyan,...cyan,...cyan]);
  const still = rgbPng(3,2,staticBasin);
  assert.equal(countVisibleWaterPixels({png:still,bounds:{x:0,y:0,width:3,height:2},viewportWidth:3,viewportHeight:2,minimumPixels:6}).visibleWaterPixelCount, 6,
    'fixture reproduces the prior false closure: stationary basin alone meets the visible-water threshold');
  assert.equal(countChangedVisibleWaterPixels({beforePng:still,afterPng:still,bounds:{x:0,y:0,width:3,height:2},viewportWidth:3,viewportHeight:2}).changedWaterPixelCount, 0);
  const moving = rgbPng(3,2,Buffer.from([...cyan,...cyan,...cyan, ...black,...cyan,...cyan]));
  const changed = countChangedVisibleWaterPixels({beforePng:still,afterPng:moving,bounds:{x:0,y:0,width:3,height:2},viewportWidth:3,viewportHeight:2});
  assert.equal(changed.changedWaterPixelCount, 1);
  assert.equal(changed.sampledPixels, 6);
  assert.throws(() => countChangedVisibleWaterPixels({beforePng:still,afterPng:rgbPng(2,2,Buffer.alloc(12)),bounds:{x:0,y:0,width:3,height:2},viewportWidth:3,viewportHeight:2}), /one pixel extent/);
});
