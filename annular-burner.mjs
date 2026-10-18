export const BURNER_SCHEMA = 'kaminos.annular-burner.v1';
export const BURNER_DEFAULTS = Object.freeze({
  schema: BURNER_SCHEMA, innerRadius: 0.025, outerRadius: 0.87,
  ringCount: 24, grooveFraction: 0.38, grooveDepth: 0.012,
  sectorCount: 12, thickness: 0.065, rimHeight: 0.018,
  subdivisions: 192, glow: 2.5, coolingSeconds: 0.6,
  bedColor: '#666b70', rimColor: '#333a40', glowColor: '#579cff',
});

export function normalizeBurner(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || value.schema !== BURNER_SCHEMA) throw new Error('Unsupported burner recipe');
  const recipe = { ...BURNER_DEFAULTS, ...value };
  if (recipe.enabled !== undefined && typeof recipe.enabled !== 'boolean') throw new Error('Burner enabled must be a boolean');
  for (const key of ['innerRadius', 'outerRadius', 'grooveFraction', 'grooveDepth', 'thickness', 'rimHeight', 'glow', 'coolingSeconds']) {
    if (typeof recipe[key] !== 'number' || !Number.isFinite(recipe[key]) || recipe[key] < 0) throw new Error(`Burner ${key} must be a finite non-negative number`);
  }
  if (recipe.outerRadius <= recipe.innerRadius) throw new Error('Burner outer radius must exceed inner radius');
  if (recipe.grooveDepth <= 0 || recipe.grooveDepth >= recipe.thickness) throw new Error('Burner groove depth must be positive and below bed thickness');
  if (recipe.grooveFraction <= 0 || recipe.grooveFraction >= 1) throw new Error('Burner groove fraction must be between zero and one');
  for (const [key, minimum] of [['ringCount', 1], ['sectorCount', 1], ['subdivisions', 3]]) {
    if (!Number.isSafeInteger(recipe[key]) || recipe[key] < minimum) throw new Error(`Burner ${key} must be an integer >= ${minimum}`);
  }
  if (recipe.subdivisions < recipe.sectorCount * 2) throw new Error('Burner subdivisions must provide at least two segments per sector');
  for (const key of ['bedColor', 'rimColor', 'glowColor']) {
    if (!/^#[a-f\d]{6}$/i.test(recipe[key])) throw new Error(`Invalid burner ${key}`);
  }
  return recipe;
}

export function burnerRings(recipe) {
  const p = normalizeBurner(recipe);
  const pitch = (p.outerRadius - p.innerRadius) / p.ringCount;
  return Array.from({ length: p.ringCount }, (_, index) => ({
    radius: p.innerRadius + pitch * (index + 0.5), width: pitch * p.grooveFraction, pitch,
  }));
}

// The ordinary renderer shares the simulation's unit-box world coordinates.
export function burnerSource(receipt) {
  const descriptor = receipt?.compilerReceipt?.descriptor;
  const support = descriptor?.support;
  if (receipt?.fallbackUsed !== false || receipt?.effective?.family !== 'ring'
    || descriptor?.family !== 'ring' || descriptor.coordinateSpace !== 'volume-local'
    || support?.primitive !== 'analytic-annulus'
    || !['legacy-volume', 'shallow-primary'].includes(descriptor.sourceLaw)) return null;
  if (!Array.isArray(support.origin) || support.origin.length !== 3 || !support.origin.every(Number.isFinite)
    || !Array.isArray(support.axis) || support.axis.length !== 3 || !support.axis.every(Number.isFinite)
    || !(support.radius > 0) || !Number.isFinite(support.radius)
    || !(support.tubeRadius > 0) || !Number.isFinite(support.tubeRadius)
    || !(descriptor.sourceDepth > 0) || !Number.isFinite(descriptor.sourceDepth)
    || !(descriptor.strength >= 0) || !Number.isFinite(descriptor.strength)) return null;
  const axisLength = Math.hypot(...support.axis);
  if (Math.abs(axisLength - 1) > 1e-6) return null;
  // Shallow injection intersects the torus with a slab; legacy injection uses the full torus.
  const axialHalfExtent = descriptor.sourceLaw === 'shallow-primary'
    ? Math.min(support.tubeRadius, descriptor.sourceDepth * 0.5) : support.tubeRadius;
  return { origin: [...support.origin], axis: [...support.axis], radius: support.radius, width: support.tubeRadius,
    strength: descriptor.strength, sourceDepth: descriptor.sourceDepth,
    sourceLaw: descriptor.sourceLaw, axialHalfExtent };
}

export function burnerActivation(radius, source) {
  if (!source || source.strength === 0) return 0;
  const distance = Math.abs(radius - source.radius) / source.width;
  if (distance >= 1) return 0;
  const t = 1 - distance;
  return t * t * (3 - 2 * t) * source.strength / (1 + source.strength);
}

export function coolBurner(previous, target, seconds, coolingSeconds) {
  if (target >= previous || coolingSeconds === 0) return target;
  return target + (previous - target) * Math.exp(-Math.max(0, seconds) / coolingSeconds);
}

export function createAnnularBurner(THREE, mergeGeometries, value) {
  const recipe = normalizeBurner(value);
  const group = new THREE.Group();
  group.name = 'Annular burner';
  const materials = [];
  const makeMaterial = parameters => {
    const material = new THREE.MeshStandardMaterial(parameters);
    materials.push(material);
    return material;
  };
  const bedMaterial = makeMaterial({ color: recipe.bedColor, roughness: 0.83, metalness: 0.1 });
  const rimMaterial = makeMaterial({ color: recipe.rimColor, roughness: 0.36, metalness: 0.85 });
  const channelMaterial = makeMaterial({ color: '#171b20', roughness: 0.78, metalness: 0.3 });
  const add = (geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const lathe = (points, segments = recipe.subdivisions, start = 0, length = Math.PI * 2) =>
    new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments, start, length);
  const bevel = (inside, outside, bottom, top) => {
    const b = Math.min((outside - inside) * 0.18, (top - bottom) * 0.25);
    return [[inside, bottom], [outside, bottom], [outside, top - b],
      [outside - b, top], [inside + b, top], [inside, top - b], [inside, bottom]];
  };
  add(lathe(bevel(recipe.innerRadius, recipe.outerRadius, -recipe.thickness, -recipe.grooveDepth)), channelMaterial);
  const pitch = (recipe.outerRadius - recipe.innerRadius) / recipe.ringCount;
  const seam = Math.min(0.012, Math.PI / recipe.sectorCount * 0.06);
  const ribs = [];
  const channels = burnerRings(recipe).map(({ radius, width }) => {
    const inside = radius - width * 0.5;
    const outside = radius + width * 0.5;
    const material = makeMaterial({ color: '#18212c', roughness: 0.65, metalness: 0.2,
      emissive: recipe.glowColor, emissiveIntensity: 0 });
    add(lathe([[outside, -recipe.grooveDepth + 0.001], [inside, -recipe.grooveDepth + 0.001]]), material);
    for (let sector = 0; sector < recipe.sectorCount; sector++) {
      for (const [lo, hi] of [[outside, radius + pitch * 0.5], [radius - pitch * 0.5, inside]]) {
        ribs.push(lathe(bevel(lo, hi, -recipe.grooveDepth, 0),
          Math.ceil(recipe.subdivisions / recipe.sectorCount),
          sector * Math.PI * 2 / recipe.sectorCount + seam * 0.5,
          Math.PI * 2 / recipe.sectorCount - seam));
      }
    }
    return { radius, material, heat: 0 };
  });
  add(mergeGeometries(ribs), bedMaterial);
  ribs.forEach(geometry => geometry.dispose());
  const rimWidth = 0.045;
  add(lathe(bevel(recipe.outerRadius, recipe.outerRadius + rimWidth, -recipe.thickness, recipe.rimHeight)), rimMaterial);
  const cap = new THREE.CylinderGeometry(recipe.innerRadius, recipe.innerRadius, recipe.thickness, recipe.subdivisions);
  cap.translate(0, -recipe.thickness * 0.5, 0);
  add(cap, rimMaterial);
  const bolts = [];
  for (let i = 0; i < recipe.sectorCount; i++) {
    const angle = i * Math.PI * 2 / recipe.sectorCount;
    const bolt = new THREE.CylinderGeometry(0.013, 0.013, 0.012, 6);
    bolt.translate(Math.sin(angle) * (recipe.outerRadius + rimWidth * 0.5), recipe.rimHeight + 0.005,
      Math.cos(angle) * (recipe.outerRadius + rimWidth * 0.5));
    bolts.push(bolt);
  }
  add(mergeGeometries(bolts), rimMaterial);
  bolts.forEach(geometry => geometry.dispose());
  let lastTime = null;
  let state = { effective: false, reason: 'ring-emitter-unavailable', recipe };
  return {
    group, recipe,
    update(receipt, active, now, domainTranslation = [0, 0, 0], { authored = false, domainScale = 1 } = {}) {
      let source = burnerSource(receipt);
      if(source)source={...source,origin:source.origin.map(value=>value*domainScale),radius:source.radius*domainScale,width:source.width*domainScale,axialHalfExtent:source.axialHalfExtent*domainScale};
      group.visible = authored ? recipe.enabled !== false : !!source;
      if (authored && source) {
        // Only heat concentric, aligned channels beneath this actual authored bed.
        // Geometry remains visible and independently placeable without emission.
        group.updateWorldMatrix(true, false);
        const origin = group.worldToLocal(new THREE.Vector3(...source.origin).add(new THREE.Vector3(...domainTranslation)));
        const axis = new THREE.Vector3(...source.axis).transformDirection(group.matrixWorld.clone().invert());
        const scale = group.getWorldScale(new THREE.Vector3()).x;
        if (Math.hypot(origin.x, origin.z) > source.width / scale || axis.y < .999
            || origin.y < 0 || origin.y > (source.axialHalfExtent + .02) / scale) source = null;
        else source = {...source, radius:source.radius/scale, width:source.width/scale};
      }
      const seconds = lastTime === null ? 0 : (now - lastTime) / 1000;
      lastTime = now;
      if (source && !authored) {
        const axis = new THREE.Vector3(...source.axis);
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
        group.position.set(
          source.origin[0] + domainTranslation[0],
          source.origin[1] + domainTranslation[1],
          source.origin[2] + domainTranslation[2],
        ).addScaledVector(axis, -source.axialHalfExtent - 0.003);
      }
      for (const channel of channels) {
        const target = active ? burnerActivation(channel.radius, source) : 0;
        channel.heat = coolBurner(channel.heat, target, seconds, recipe.coolingSeconds);
        channel.material.emissiveIntensity = channel.heat * recipe.glow;
      }
      const covered = !!source && source.radius - source.width >= recipe.innerRadius && source.radius + source.width <= recipe.outerRadius;
      state = { effective: !!source, reason: !source ? 'ring-emitter-unavailable' : (covered ? null : 'emitter-outside-bed'),
        recipe, source, covered, active: !!active, heat: channels.map(channel => channel.heat) };
      return state;
    },
    debugState: () => state,
    dispose() {
      group.removeFromParent();
      group.traverse(object => object.geometry?.dispose());
      materials.forEach(material => material.dispose());
    },
  };
}

// Coarse stand-in of the burner for shadow casting and other consumers of its shape. It keeps
// the bed, every ring groove and land, the sector seams and the rim where the burner has them,
// and drops what only dresses the surface: the bolts, the separate channel floors (the bed top is
// raised the 1 mm to where they stand) and the bevels of the bed and lands (each becomes its
// enclosing rectangle, so the stand-in is never lower or narrower than the burner). Back-to-back
// ribs merge into one land.
// Arcs are tessellated so no chord falls more than maxSagitta inside its circle.
export const BURNER_CASTER_SCHEMA = 'kaminos.annular-burner-caster.v1';
const CASTER_SHAPE_KEYS = ['innerRadius', 'outerRadius', 'ringCount', 'grooveFraction', 'grooveDepth', 'sectorCount', 'thickness', 'rimHeight'];
const BURNER_RIM_WIDTH = 0.045;

// Identity of the caster a recipe produces: changes with the shape it depends on, not with
// colours, glow, cooling or the burner's own tessellation.
export function annularBurnerCasterKey(value, { maxSagitta = 0.002 } = {}) {
  const recipe = normalizeBurner(value);
  if (!(typeof maxSagitta === 'number' && Number.isFinite(maxSagitta) && maxSagitta > 0)) throw new Error('Caster maxSagitta must be a positive number');
  return `${BURNER_CASTER_SCHEMA}:${JSON.stringify([...CASTER_SHAPE_KEYS.map(key => recipe[key]), maxSagitta])}`;
}

export function createAnnularBurnerCaster(THREE, mergeGeometries, value, { maxSagitta = 0.002 } = {}) {
  const key = annularBurnerCasterKey(value, { maxSagitta });
  const recipe = normalizeBurner(value);
  // Segments over an arc of `length` radians at radius r so no chord sags more than maxSagitta.
  const segmentsFor = (r, length) => {
    const step = maxSagitta >= r ? Math.PI : 2 * Math.acos(1 - maxSagitta / r);
    return Math.max(length >= Math.PI * 2 - 1e-9 ? 8 : 1, Math.ceil(length / step));
  };
  const parts = [];
  const lathe = (points, start = 0, length = Math.PI * 2) => {
    const r = Math.max(...points.map(([radius]) => radius));
    parts.push(new THREE.LatheGeometry(points.map(([radius, y]) => new THREE.Vector2(radius, y)), segmentsFor(r, length), start, length));
  };
  // The bed's top stands at the burner's channel floors, which cover its own bed top 1 mm lower.
  const top = -recipe.grooveDepth + 0.001;
  // Bed: bottom, outer wall, top (the groove floors), inner wall.
  lathe([[recipe.innerRadius, -recipe.thickness], [recipe.outerRadius, -recipe.thickness], [recipe.outerRadius, top], [recipe.innerRadius, top], [recipe.innerRadius, -recipe.thickness]]);
  // Lands between grooves, one per sector, open ends at the seams as on the burner.
  const rings = burnerRings(recipe);
  const lands = [[recipe.innerRadius, rings[0].radius - rings[0].width * 0.5]];
  for (let i = 0; i < rings.length; i++) lands.push([rings[i].radius + rings[i].width * 0.5, i + 1 < rings.length ? rings[i + 1].radius - rings[i + 1].width * 0.5 : recipe.outerRadius]);
  const seam = Math.min(0.012, Math.PI / recipe.sectorCount * 0.06);
  for (const [inside, outside] of lands) {
    if (!(outside > inside)) continue;
    for (let sector = 0; sector < recipe.sectorCount; sector++) {
      lathe([[outside, top], [outside, 0], [inside, 0], [inside, top]],
        sector * Math.PI * 2 / recipe.sectorCount + seam * 0.5, Math.PI * 2 / recipe.sectorCount - seam);
    }
  }
  // The rim keeps its bevel: at 8 mm on the default burner it shapes the outer outline. The
  // centre cap is a plain cylinder, as on the burner.
  const rimOut = recipe.outerRadius + BURNER_RIM_WIDTH, rimTop = recipe.rimHeight, rimBottom = -recipe.thickness;
  const b = Math.min(BURNER_RIM_WIDTH * 0.18, (rimTop - rimBottom) * 0.25);
  lathe([[recipe.outerRadius, rimBottom], [rimOut, rimBottom], [rimOut, rimTop - b], [rimOut - b, rimTop], [recipe.outerRadius + b, rimTop], [recipe.outerRadius, rimTop - b], [recipe.outerRadius, rimBottom]]);
  const cap = new THREE.CylinderGeometry(recipe.innerRadius, recipe.innerRadius, recipe.thickness, segmentsFor(recipe.innerRadius, Math.PI * 2));
  cap.translate(0, -recipe.thickness * 0.5, 0);
  parts.push(cap.index ? cap.toNonIndexed() : cap);
  cap.dispose();
  const flat = parts.map(part => { const g = part.index ? part.toNonIndexed() : part; for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name); return g; });
  const geometry = mergeGeometries(flat);
  parts.forEach(part => part.dispose()); flat.forEach(part => part.dispose());
  if (!geometry) throw new Error('Burner caster geometry could not be merged');
  return { geometry, key, triangles: geometry.attributes.position.count / 3, bound: { maxSagitta, conservativeBevels: true },
    omitted: ['bolts', 'channel-floors', 'bevels'] };
}
