// Model maps are top-down RGBA; photo-surface UVs have their origin at the bottom.
// Reverse rows explicitly rather than depending on backend-specific texture flipY.
export function texturePixels(map, role) {
  if (!['albedo', 'orm', 'roughness', 'metallic', 'normals', 'depth'].includes(role)) throw new Error('Unknown map role');
  const { width, height, data } = map ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new Error('Invalid material map dimensions');
  }
  const output = new Uint8Array(data.length), stride = width * 4;
  for (let y = 0; y < height; y++) output.set(data.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  return { data: output, width, height, color: role === 'albedo' };
}

export function createPhotoRunState() {
  let revision = 0, source = null, geometry = null, materials = null;
  return {
    select(value) { source = value; geometry = materials = null; return ++revision; },
    publish(token, kind, value) {
      if (token !== revision) throw new Error('Photograph was superseded');
      if (kind === 'geometry') { geometry = value; materials = null; }
      else if (kind === 'materials') {
        if (!geometry) throw new Error('Material surface requires geometry');
        materials = value;
      } else throw new Error('Unknown photograph result');
    },
    snapshot() { return { revision, source, geometry, materials }; },
  };
}
