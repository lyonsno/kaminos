// 8-bit SuperMat maps from the decoded float planes, quantized like the source.
export const SUPERMAT_MAP_SIZE = 512;

// numpy (x * 255.0).round() on float32: half-to-even after an F32 product.
function quantize(value) {
  const scaled = Math.fround(Math.fround(Math.min(1, Math.max(0, value))) * 255);
  const floor = Math.floor(scaled), fraction = scaled - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function mapsFromPlanes(albedo, orm, size = SUPERMAT_MAP_SIZE) {
  const plane = size * size;
  const make = () => new Uint8ClampedArray(plane * 4);
  const maps = { albedo: make(), roughness: make(), metallic: make(), orm: make() };
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      maps.albedo[o + c] = quantize(albedo[c * plane + i]);
      maps.orm[o + c] = quantize(orm[c * plane + i]);
    }
    const roughness = quantize(orm[plane + i]), metallic = quantize(orm[2 * plane + i]);
    maps.roughness[o] = maps.roughness[o + 1] = maps.roughness[o + 2] = roughness;
    maps.metallic[o] = maps.metallic[o + 1] = maps.metallic[o + 2] = metallic;
    maps.albedo[o + 3] = maps.roughness[o + 3] = maps.metallic[o + 3] = maps.orm[o + 3] = 255;
  }
  return Object.fromEntries(Object.entries(maps).map(([name, data]) => [name, { width: size, height: size, data }]));
}

