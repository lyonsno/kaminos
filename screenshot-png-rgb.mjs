import { inflateSync } from 'node:zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodeScreenshotPngRgb(input) {
  const png = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('Screenshot is not a PNG');
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const compressed = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8, dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error('Screenshot PNG has a truncated chunk');
    if (type === 'IHDR') {
      width = png.readUInt32BE(dataStart); height = png.readUInt32BE(dataStart + 4);
      bitDepth = png[dataStart + 8]; colorType = png[dataStart + 9]; interlace = png[dataStart + 12];
    } else if (type === 'IDAT') compressed.push(png.subarray(dataStart, dataEnd));
    else if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(`Screenshot PNG layout is unsupported: ${width}x${height}, depth ${bitDepth}, type ${colorType}, interlace ${interlace}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  if (raw.length !== height * (rowBytes + 1)) throw new Error('Screenshot PNG decompressed extent is inconsistent');
  const pixels = Buffer.alloc(height * rowBytes);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++], rowOffset = y * rowBytes, priorOffset = rowOffset - rowBytes;
    if (filter > 4) throw new Error(`Screenshot PNG uses unknown row filter ${filter}`);
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const up = y > 0 ? pixels[priorOffset + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[priorOffset + x - channels] : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2)
        : filter === 4 ? paeth(left, up, upperLeft) : 0;
      pixels[rowOffset + x] = (raw[src++] + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

export function countVisibleWaterPixels({ png, bounds, viewportWidth, viewportHeight, minimumPixels = 100 }) {
  const decoded = decodeScreenshotPngRgb(png);
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new Error('Screenshot CSS viewport identity is invalid');
  }
  const scaleX = decoded.width / viewportWidth, scaleY = decoded.height / viewportHeight;
  const left = Math.max(0, Math.floor(bounds.x * scaleX));
  const top = Math.max(0, Math.floor(bounds.y * scaleY));
  const right = Math.min(decoded.width, Math.ceil((bounds.x + bounds.width) * scaleX));
  const bottom = Math.min(decoded.height, Math.ceil((bounds.y + bounds.height) * scaleY));
  if (right <= left || bottom <= top) throw new Error('Screenshot viewport bounds do not intersect its pixel extent');
  let visibleWaterPixelCount = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * decoded.width + x) * decoded.channels;
      const red = decoded.pixels[offset], green = decoded.pixels[offset + 1], blue = decoded.pixels[offset + 2];
      if (blue >= 95 && green >= 80 && blue - red >= 18 && green - red >= 12) visibleWaterPixelCount++;
    }
  }
  return { visibleWaterPixelCount, sampledPixels: (right - left) * (bottom - top), minimumPixels, imageWidth:decoded.width, imageHeight:decoded.height };
}
