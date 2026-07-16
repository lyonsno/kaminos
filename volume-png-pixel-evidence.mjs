import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function analyzePngPixels(path, { foregroundThreshold = 8 } = {}) {
  const decoded = decodePng(path);
  let foregroundPixelCount = 0;
  let sumRgb = 0;
  let maxRgb = 0;
  let minX = decoded.width;
  let minY = decoded.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < decoded.width * decoded.height; index += 1) {
    const offset = index * 4;
    const red = decoded.rgba[offset];
    const green = decoded.rgba[offset + 1];
    const blue = decoded.rgba[offset + 2];
    const alpha = decoded.rgba[offset + 3];
    const brightest = Math.max(red, green, blue);
    sumRgb += red + green + blue;
    maxRgb = Math.max(maxRgb, brightest);
    if (alpha === 0 || brightest <= foregroundThreshold) continue;
    foregroundPixelCount += 1;
    const x = index % decoded.width;
    const y = Math.floor(index / decoded.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pixelCount = decoded.width * decoded.height;
  return {
    identity: 'decoded-rgba-pixel-evidence-v0',
    decoder: 'ffmpeg-rgba8-v0',
    path,
    width: decoded.width,
    height: decoded.height,
    pixelCount,
    foregroundThreshold,
    foregroundPixelCount,
    foregroundFraction: foregroundPixelCount / pixelCount,
    meanRgb: sumRgb / (pixelCount * 3),
    maxRgb,
    boundingBox: foregroundPixelCount > 0
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : { x: null, y: null, width: 0, height: 0 },
  };
}

export function comparePngPixels(leftPath, rightPath, { changedThreshold = 2 } = {}) {
  const left = decodePng(leftPath);
  const right = decodePng(rightPath);
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`PNG dimensions differ: ${left.width}x${left.height}/${right.width}x${right.height}`);
  }
  let absoluteRgbDifference = 0;
  let changedPixelCount = 0;
  const pixelCount = left.width * left.height;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const delta = Math.abs(left.rgba[offset] - right.rgba[offset])
      + Math.abs(left.rgba[offset + 1] - right.rgba[offset + 1])
      + Math.abs(left.rgba[offset + 2] - right.rgba[offset + 2]);
    absoluteRgbDifference += delta;
    if (delta / 3 > changedThreshold) changedPixelCount += 1;
  }
  return {
    identity: 'decoded-rgba-role-difference-v0',
    decoder: 'ffmpeg-rgba8-v0',
    leftPath,
    rightPath,
    width: left.width,
    height: left.height,
    pixelCount,
    changedThreshold,
    changedPixelCount,
    changedPixelFraction: changedPixelCount / pixelCount,
    meanAbsoluteRgbDifference: absoluteRgbDifference / (pixelCount * 3),
  };
}

function decodePng(path) {
  const png = readFileSync(path);
  if (png.length < 24 || png.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new Error(`not a PNG: ${path}`);
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`invalid PNG dimensions: ${path}`);
  }
  const expectedBytes = width * height * 4;
  const result = spawnSync('ffmpeg', [
    '-v', 'error',
    '-i', path,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    'pipe:1',
  ], { encoding: null, maxBuffer: Math.max(16 * 1024 * 1024, expectedBytes + 1024) });
  if (result.status !== 0) {
    throw new Error(`PNG decode failed for ${path}: ${result.stderr?.toString('utf8') || result.status}`);
  }
  if (result.stdout.length !== expectedBytes) {
    throw new Error(`decoded PNG byte length mismatch for ${path}: ${result.stdout.length}/${expectedBytes}`);
  }
  return { width, height, rgba: result.stdout };
}
