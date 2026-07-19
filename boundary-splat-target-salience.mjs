export const BOUNDARY_SPLAT_TARGET_SALIENCE_ORACLE_IDENTITY = 'boundary-splat-target-salience-oracle-v0';
export const BOUNDARY_SPLAT_TARGET_SALIENCE_SCORE_IDENTITY = 'target-luma-times-local-gradient-rank-v0';

function assertPreview(preview) {
  const width = Number(preview?.width);
  const height = Number(preview?.height);
  const rgba = preview?.rgba;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`boundary-splat-target-oracle-preview-shape:${width}:${height}`);
  }
  if (!Array.isArray(rgba) && !(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray)) {
    throw new Error('boundary-splat-target-oracle-preview-rgba-missing');
  }
  if (rgba.length !== width * height * 4) {
    throw new Error(`boundary-splat-target-oracle-preview-rgba-length:${rgba.length}:${width * height * 4}`);
  }
  return { width, height, rgba };
}

function lumaAt(rgba, pixelIndex) {
  const offset = pixelIndex * 4;
  return (0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2]) / 255;
}

export function targetSalienceMap(preview) {
  const { width, height, rgba } = assertPreview(preview);
  const luma = new Float32Array(width * height);
  for (let index = 0; index < luma.length; index += 1) luma[index] = lumaAt(rgba, index);
  const gradient = new Float32Array(luma.length);
  let maxGradient = 0;
  const sample = (x, y) => luma[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      const magnitude = Math.hypot(dx, dy) * 0.5;
      gradient[y * width + x] = magnitude;
      maxGradient = Math.max(maxGradient, magnitude);
    }
  }
  const scores = new Float32Array(luma.length);
  let maxScore = 0;
  for (let index = 0; index < scores.length; index += 1) {
    const normalizedGradient = maxGradient > 0 ? gradient[index] / maxGradient : 0;
    const score = luma[index] * (0.25 + 0.75 * normalizedGradient);
    scores[index] = score;
    maxScore = Math.max(maxScore, score);
  }
  if (maxScore > 0) {
    for (let index = 0; index < scores.length; index += 1) scores[index] /= maxScore;
  }
  return {
    identity: BOUNDARY_SPLAT_TARGET_SALIENCE_SCORE_IDENTITY,
    width,
    height,
    scores,
    maxGradient,
    maxScore,
  };
}

function nativeCellIndexForPosition(position, grid) {
  const cell = position.map(component => Math.round(((component + 1) * 0.5 * grid) - 0.5));
  if (cell.some(component => component < 0 || component >= grid)) {
    throw new Error(`boundary-splat-target-oracle-candidate-outside-grid:${cell.join(',')}:${grid}`);
  }
  return cell[0] + cell[1] * grid + cell[2] * grid * grid;
}

function projectToPixel(position, matrix, width, height) {
  const [x, y, z] = position;
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!(clipW > 0)) return null;
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  const ndcZ = clipZ / clipW;
  if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1 || ndcZ < 0 || ndcZ > 1) return null;
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor((ndcX * 0.5 + 0.5) * width))),
    y: Math.max(0, Math.min(height - 1, Math.floor((1 - (ndcY * 0.5 + 0.5)) * height))),
  };
}

export function buildTargetSalienceOracleScores({
  targetPreview,
  candidateValues,
  candidateStrideFloats = 19,
  candidateCount,
  grid,
  viewProjection,
  mediumCount,
  heroCount,
} = {}) {
  if (!(candidateValues instanceof Float32Array)) throw new Error('boundary-splat-target-oracle-candidate-values-missing');
  if (!Number.isInteger(candidateCount) || candidateCount <= 0) throw new Error(`boundary-splat-target-oracle-candidate-count:${candidateCount}`);
  if (!Number.isInteger(candidateStrideFloats) || candidateStrideFloats < 3) throw new Error(`boundary-splat-target-oracle-candidate-stride:${candidateStrideFloats}`);
  if (candidateValues.length !== candidateCount * candidateStrideFloats) {
    throw new Error(`boundary-splat-target-oracle-candidate-shape:${candidateValues.length}:${candidateCount * candidateStrideFloats}`);
  }
  if (!Number.isInteger(grid) || grid <= 0) throw new Error(`boundary-splat-target-oracle-grid:${grid}`);
  if (!Array.isArray(viewProjection) || viewProjection.length !== 16 || viewProjection.some(value => !Number.isFinite(Number(value)))) {
    throw new Error('boundary-splat-target-oracle-view-projection');
  }
  if (!Number.isInteger(mediumCount) || mediumCount < 0 || !Number.isInteger(heroCount) || heroCount < 0 || mediumCount + heroCount > candidateCount) {
    throw new Error(`boundary-splat-target-oracle-tier-counts:${mediumCount}:${heroCount}:${candidateCount}`);
  }
  const salience = targetSalienceMap(targetPreview);
  const ranked = [];
  const seenCells = new Set();
  let projectedCount = 0;
  for (let rowIndex = 0; rowIndex < candidateCount; rowIndex += 1) {
    const offset = rowIndex * candidateStrideFloats;
    const position = [candidateValues[offset], candidateValues[offset + 1], candidateValues[offset + 2]];
    if (position.some(value => !Number.isFinite(value))) throw new Error(`boundary-splat-target-oracle-nonfinite-position:${rowIndex}`);
    const cellIndex = nativeCellIndexForPosition(position, grid);
    if (seenCells.has(cellIndex)) throw new Error(`boundary-splat-target-oracle-duplicate-cell:${cellIndex}`);
    seenCells.add(cellIndex);
    const pixel = projectToPixel(position, viewProjection, salience.width, salience.height);
    if (pixel) {
      projectedCount += 1;
      ranked.push({ cellIndex, score: salience.scores[pixel.y * salience.width + pixel.x] });
    }
  }
  if (mediumCount + heroCount > projectedCount) {
    throw new Error(`boundary-splat-target-oracle-visible-tier-counts:${mediumCount + heroCount}:${projectedCount}`);
  }
  ranked.sort((left, right) => right.score - left.score || left.cellIndex - right.cellIndex);
  const denseScores = new Float32Array(grid * grid * grid);
  for (let index = 0; index < heroCount; index += 1) denseScores[ranked[index].cellIndex] = 1;
  for (let index = heroCount; index < heroCount + mediumCount; index += 1) denseScores[ranked[index].cellIndex] = 0.85;
  return {
    identity: BOUNDARY_SPLAT_TARGET_SALIENCE_ORACLE_IDENTITY,
    scoreIdentity: BOUNDARY_SPLAT_TARGET_SALIENCE_SCORE_IDENTITY,
    grid,
    candidateCount,
    projectedCount,
    counts: {
      base: candidateCount - mediumCount - heroCount,
      medium: mediumCount,
      hero: heroCount,
    },
    denseScores,
    salience: {
      identity: salience.identity,
      width: salience.width,
      height: salience.height,
      maxGradient: salience.maxGradient,
      maxScore: salience.maxScore,
    },
  };
}
