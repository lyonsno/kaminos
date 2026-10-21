// Coarse levels for one TRELLIS generation, from its raw decode and material field, published as
// levels of its stored finished mesh (the hero). Runs in the page or in Node: the caller passes
// THREE, MeshBVH, the TRELLIS finisher, the UV unwrapper and worker class, and fetch (same-origin
// in the page, a server URL prefix in Node). It needs the decode and the field while they are
// alive: call it before the generation releases them.
//
// Steps: refuse taken level slots (unless replacing); remesh and bake the low tiers from the decode
// and field; check each tier's frame against the hero and measure its error against the hero;
// bake a tangent-space normal map from the hero's shading; ingest and register each tier.
// `report` is updated at every phase and returned, including on failure (with `error`).
import {prepareLowTiers, readGLBWorldMesh, measureGeometricError} from './mesh-lod-ladder.mjs';
import {addNormalMapToGLB, createHeroNormalSampler} from './lod-normal-bake.mjs';

export const LOW_TIER_ROUTE = 'closed-remesh+projection+trellis-simplify';

const sha256 = async array => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(array.buffer, array.byteOffset, array.byteLength)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

export async function prepareGenerationLevels({decode: {vertices, triangles}, materialFields, source, heroGLB = null, server = '', fetch = globalThis.fetch,
  THREE, MeshBVH, finish, unwrapMesh, WorkerClass, targets = [5000, 1000, 500], replace = false, normalMaps = true, input = null, route = null,
  report = {}, onPhase = () => {}}) {
  Object.assign(report, {schema: 'kaminos.lod-tiers-report.v0', source, targets, tiers: report.tiers ?? []});
  const phase = name => { report.phase = name; onPhase(report); };
  try {
    if (!/^[a-f0-9]{64}$/.test(source || '')) throw Error('source must be the sha256 of the stored hero mesh');
    if (!targets.length || !targets.every(t => Number.isSafeInteger(t) && t > 0)) throw Error('at least one target face count is required, each a positive integer');
    report.raw = {vertices: vertices.length / 3, faces: triangles.length / 3};
    // Refuse taken slots before storing anything (unless replacing): the server keeps one level per
    // (faces, route), and a tier stored but then refused would linger as an unregistered mesh.
    phase('preflight');
    const existing = await fetch(`${server}/api/mesh-lods?source=${source}`);
    if (!existing.ok) throw Error(`cannot read existing levels (HTTP ${existing.status})`);
    const existingLevels = (await existing.json()).levels;
    const slotTaken = faces => existingLevels.find(l => l.route === LOW_TIER_ROUTE && l.faces === faces);
    const taken = targets.map(slotTaken).filter(Boolean);
    if (taken.length && !replace) throw Error(taken.map(l => `a ${l.faces}-face ${l.route} level is already registered: ${l.sha256}`).join('; '));
    if (!heroGLB) {
      const response = await fetch(`${server}/api/read?root=generated-meshes&path=${source}.glb`);
      if (!response.ok) throw Error(`source mesh ${source} is not stored (HTTP ${response.status})`);
      heroGLB = await response.arrayBuffer();
    }
    const inputDigests = {'vertices.f32': await sha256(vertices), 'triangles.u32': await sha256(triangles)};
    phase('bvh');
    // Closest point plus that face's normal on a surface, through a BVH over it.
    const closestFor = (V, F) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(V, 3)); geometry.setIndex(new THREE.BufferAttribute(F, 1));
      const bvh = new MeshBVH(geometry), point = new THREE.Vector3(), hit = {};
      return (x, y, z) => {
        bvh.closestPointToPoint(point.set(x, y, z), hit);
        const t = hit.faceIndex * 3, a = F[t]*3, b = F[t+1]*3, c = F[t+2]*3;
        const ux = V[b]-V[a], uy = V[b+1]-V[a+1], uz = V[b+2]-V[a+2], wx = V[c]-V[a], wy = V[c+1]-V[a+1], wz = V[c+2]-V[a+2];
        const nx = uy*wz-uz*wy, ny = uz*wx-ux*wz, nz = ux*wy-uy*wx, l = Math.hypot(nx, ny, nz) || 1;
        return {point: [hit.point.x, hit.point.y, hit.point.z], normal: [nx/l, ny/l, nz/l]};
      };
    };
    const closestSource = closestFor(vertices, triangles);
    const closestPoint = (x, y, z) => closestSource(x, y, z).point;
    phase('tiers');
    const started = performance.now();
    const tiers = await prepareLowTiers({mesh: {vertices, triangles}, materialFields, targets, closestPoint, finish, unwrapMesh, WorkerClass,
      measure: {closestSource, closestFor, reference: {kind: 'raw-decode', input, digests: inputDigests, faces: triangles.length / 3}}, provenance: {input, route}});
    report.tierSeconds = (performance.now() - started) / 1000;
    // Error against the hero, in the world frame both are drawn in. A frame mismatch is refused
    // before anything is stored.
    phase('frame-check');
    const hero = readGLBWorldMesh(heroGLB);
    const bounds = V => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], V[i+a]); hi[a] = Math.max(hi[a], V[i+a]); } return {lo, hi}; };
    const hb = bounds(hero.vertices), heroDiagonal = Math.hypot(...hb.hi.map((h, a) => h - hb.lo[a])), heroClosest = closestFor(hero.vertices, hero.faces);
    for (const tier of tiers) {
      const world = readGLBWorldMesh(tier.glb), tb = bounds(world.vertices);
      const drift = Math.max(...[0, 1, 2].flatMap(a => [Math.abs(tb.lo[a] - hb.lo[a]), Math.abs(tb.hi[a] - hb.hi[a])])) / heroDiagonal;
      tier.frameDrift = drift;
      // A wrong frame (rotation, swapped axes) drifts by tens of percent; a closed remesh legitimately
      // grows thin parts by up to one grid cell, a few percent. Smaller misalignment shows in the error.
      if (!(drift <= 0.1)) throw Error(`level ${tier.target} bounds differ from the hero by ${(drift * 100).toFixed(1)}% of its diagonal; frames disagree`);
      tier.errorAgainstRawDecode = tier.error;
      tier.error = measureGeometricError({source: hero, level: world, closestSource: heroClosest, closestLevel: closestFor(world.vertices, world.faces),
        reference: {kind: 'hero', sha256: source, faces: hero.faces.length / 3}});
      const slot = slotTaken(tier.faces);
      if (slot && !replace && !targets.includes(tier.faces)) throw Error(`level ${tier.target} landed at ${tier.faces} faces, a slot already registered: ${slot.sha256}`);
    }
    // Normal maps from the hero, in the same world frame, before anything is stored.
    if (normalMaps) {
      phase('normal-map');
      if (!hero.normals) throw Error('hero has no shading normals to bake from (turn normal maps off to publish without them)');
      for (const tier of tiers) {
        // Look along the level normal as far as this level is measured to stray from the hero
        // (sampled maximum, with a quarter more since sampling underestimates it).
        const reach = 1.25 * tier.error.levelToSource.max;
        const sampleWorldNormal = createHeroNormalSampler({hero, THREE, MeshBVH, reach, footprint: true});
        tier.glb = await addNormalMapToGLB(tier.glb, {textureSize: tier.textureSize, source: {kind: 'hero', sha256: source}, sampleWorldNormal});
        tier.normalMap = {source: {kind: 'hero', sha256: source}, textureSize: tier.textureSize, sampler: 'ray-along-level-normal+texel-footprint', reach};
      }
    }
    phase('publish');
    // Each step counts only with a receipt naming what was stored or registered; a 200 that is
    // not that receipt (an HTML fallback, an empty object) is a failure, not publication.
    const receipt = async response => { const text = await response.text(); try { return JSON.parse(text); } catch { return {raw: text.slice(0, 500)}; } };
    for (const tier of tiers) {
      const bytes = new Uint8Array(tier.glb), digest = await sha256(bytes);
      const ingest = await fetch(`${server}/api/ingest-mesh`, {method: 'POST', body: bytes});
      const stored = await receipt(ingest);
      if (!ingest.ok) { report.failedTier = tier.target; throw Error(`ingest failed for ${tier.target} (HTTP ${ingest.status}): ${JSON.stringify(stored)}`); }
      if (stored.sha256 !== digest) { report.failedTier = tier.target; throw Error(`ingest receipt for ${tier.target} does not name the stored bytes ${digest}: ${JSON.stringify(stored).slice(0, 300)}`); }
      const level = {sha256: digest, faces: tier.faces, route: tier.route, textureSize: tier.textureSize,
        closed: tier.closed, boundaryEdges: tier.boundaryEdges, nonManifoldEdges: tier.nonManifoldEdges, frameDrift: tier.frameDrift,
        error: tier.error, errorAgainstRawDecode: tier.errorAgainstRawDecode, ...(tier.normalMap ? {normalMap: tier.normalMap} : {})};
      let register;
      try { register = await fetch(`${server}/api/mesh-lods`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({source, level, supersede: replace})}); }
      catch (error) { report.failedTier = tier.target; report.unconfirmedRegistration = digest; throw error; } // outcome unknown: stored, maybe registered
      const registered = await receipt(register);
      if (!register.ok) { report.failedTier = tier.target; report.orphanedIngest = digest;
        throw Error(`register failed for ${tier.target} (HTTP ${register.status}): ${JSON.stringify(registered)}`); }
      if (registered.source !== source || registered.level?.sha256 !== digest) { report.failedTier = tier.target; report.orphanedIngest = digest;
        throw Error(`registration receipt for ${tier.target} does not name level ${digest} of ${source}: ${JSON.stringify(registered).slice(0, 300)}`); }
      report.tiers.push({target: tier.target, ...level, bytes: tier.glb.byteLength, timing: tier.timing}); onPhase(report);
    }
    phase('done');
  } catch (error) {
    report.error = {message: error.message, stack: error.stack};
  }
  return report;
}
