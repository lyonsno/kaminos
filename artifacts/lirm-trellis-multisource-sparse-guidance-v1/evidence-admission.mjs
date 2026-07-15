import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from('\x89PNG\r\n\x1a\n', 'binary');

const fail = message => {
  throw new Error(message);
};

export const assertCleanJob = (receipt, expected, label = receipt?.job_id ?? 'job') => {
  if (receipt.status !== 'done') fail(`${label}: status must be done, got ${receipt.status}`);
  if (receipt.exit_code !== 0) fail(`${label}: exit_code must be 0, got ${receipt.exit_code}`);
  if (receipt.failure_phase !== null) fail(`${label}: failure_phase must be null`);
  if (receipt.error_message !== null) fail(`${label}: error_message must be null`);
  if (Array.isArray(receipt.warnings) ? receipt.warnings.length > 0 : receipt.warnings != null) {
    fail(`${label}: warnings must be empty`);
  }
  if (Array.isArray(receipt.ignored_params) ? receipt.ignored_params.length > 0 : receipt.ignored_params != null) {
    fail(`${label}: ignored_params must be empty`);
  }
  if (receipt.job_type !== expected.jobType) {
    fail(`${label}: expected job_type ${expected.jobType}, got ${receipt.job_type}`);
  }
  if (expected.effectiveCwd && receipt.effective_cwd !== expected.effectiveCwd) {
    fail(`${label}: expected effective_cwd ${expected.effectiveCwd}, got ${receipt.effective_cwd}`);
  }
};

const paeth = (left, above, upperLeft) => {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
};

const decodePng = bytes => {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail('visual evidence is not a PNG');
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) fail(`truncated PNG ${type} chunk`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height || idat.length === 0) fail('PNG lacks IHDR or IDAT data');
  if (bitDepth !== 8 || interlace !== 0) fail(`unsupported PNG format: depth=${bitDepth}, interlace=${interlace}`);
  const channels = new Map([[0, 1], [2, 3], [4, 2], [6, 4]]).get(colorType);
  if (!channels) fail(`unsupported PNG color type ${colorType}`);
  const rowBytes = width * channels;
  const packed = inflateSync(Buffer.concat(idat));
  if (packed.length !== height * (rowBytes + 1)) fail('PNG scanline size does not match IHDR');
  const decoded = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = packed[y * (rowBytes + 1)];
    const sourceStart = y * (rowBytes + 1) + 1;
    const targetStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = packed[sourceStart + x];
      const left = x >= channels ? decoded[targetStart + x - channels] : 0;
      const above = y > 0 ? decoded[targetStart + x - rowBytes] : 0;
      const upperLeft = y > 0 && x >= channels ? decoded[targetStart + x - rowBytes - channels] : 0;
      let predictor;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else fail(`unsupported PNG filter ${filter}`);
      decoded[targetStart + x] = (raw + predictor) & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (colorType === 0) {
      rgba[target] = decoded[source];
      rgba[target + 1] = decoded[source];
      rgba[target + 2] = decoded[source];
      rgba[target + 3] = 255;
    } else if (colorType === 2) {
      decoded.copy(rgba, target, source, source + 3);
      rgba[target + 3] = 255;
    } else if (colorType === 4) {
      rgba[target] = decoded[source];
      rgba[target + 1] = decoded[source];
      rgba[target + 2] = decoded[source];
      rgba[target + 3] = decoded[source + 1];
    } else {
      decoded.copy(rgba, target, source, source + 4);
    }
  }
  return { width, height, rgba };
};

const median = values => {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};
const colorDistance = (rgba, first, second) => Math.hypot(
  rgba[first] - rgba[second],
  rgba[first + 1] - rgba[second + 1],
  rgba[first + 2] - rgba[second + 2],
  (rgba[first + 3] - rgba[second + 3]) * 0.5,
);
const pixelToColorDistance = (rgba, index, color) => Math.hypot(
  rgba[index] - color[0],
  rgba[index + 1] - color[1],
  rgba[index + 2] - color[2],
  (rgba[index + 3] - color[3]) * 0.5,
);

export const inspectPngEvidence = bytes => {
  const { width, height, rgba } = decodePng(bytes);
  const luminance = new Float64Array(width * height);
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let edgeCount = 0;
  let edgeComparisons = 0;
  let activePixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const borderWidth = Math.max(1, Math.min(4, Math.floor(width / 8)));
    const border = [[], [], [], []];
    for (const x of [...Array(borderWidth).keys(), ...Array.from({ length: borderWidth }, (_, i) => width - 1 - i)]) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) border[channel].push(rgba[index + channel]);
    }
    const background = Buffer.from(border.map(median));
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      const value = 0.2126 * rgba[index] + 0.7152 * rgba[index + 1] + 0.0722 * rgba[index + 2];
      luminance[pixel] = value;
      luminanceSum += value;
      luminanceSquaredSum += value * value;
      if (pixelToColorDistance(rgba, index, background) > 28) {
        activePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (x > 0) {
        edgeComparisons += 1;
        if (colorDistance(rgba, index, index - 4) > 24) edgeCount += 1;
      }
      if (y > 0) {
        edgeComparisons += 1;
        if (colorDistance(rgba, index, index - width * 4) > 24) edgeCount += 1;
      }
    }
  }
  const pixelCount = width * height;
  const mean = luminanceSum / pixelCount;
  const activeBoundsArea = activePixels === 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1);
  return {
    width,
    height,
    luminanceStdDev: Math.sqrt(Math.max(0, luminanceSquaredSum / pixelCount - mean * mean)),
    edgeRatio: edgeCount / edgeComparisons,
    activePixelRatio: activePixels / pixelCount,
    activeBoundsRatio: activeBoundsArea / pixelCount,
    activeBounds: activePixels === 0 ? null : { minX, minY, maxX, maxY },
  };
};

export const assertUsefulPngEvidence = (evidence, options = {}, label = 'PNG evidence') => {
  const thresholds = {
    minWidth: options.minWidth ?? 256,
    minHeight: options.minHeight ?? 256,
    minLuminanceStdDev: options.minLuminanceStdDev ?? 5,
    minEdgeRatio: options.minEdgeRatio ?? 0.002,
    maxEdgeRatio: options.maxEdgeRatio ?? 0.6,
    minActivePixelRatio: options.minActivePixelRatio ?? 0.01,
    minActiveBoundsRatio: options.minActiveBoundsRatio ?? 0.03,
  };
  for (const [key, minimum] of [
    ['width', thresholds.minWidth],
    ['height', thresholds.minHeight],
    ['luminanceStdDev', thresholds.minLuminanceStdDev],
    ['edgeRatio', thresholds.minEdgeRatio],
    ['activePixelRatio', thresholds.minActivePixelRatio],
    ['activeBoundsRatio', thresholds.minActiveBoundsRatio],
  ]) {
    if (evidence[key] < minimum) fail(`${label}: ${key} ${evidence[key]} is below ${minimum}`);
  }
  if (evidence.edgeRatio > thresholds.maxEdgeRatio) {
    fail(`${label}: edgeRatio ${evidence.edgeRatio} exceeds ${thresholds.maxEdgeRatio}`);
  }
};
