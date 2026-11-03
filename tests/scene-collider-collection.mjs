// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneColliderCollection} from '../scene-collider.mjs';
import {trianglesFromSceneObject,sceneSolidRevision} from '../volume-scene-solid.mjs';
import {createProceduralMesh} from '../scene-geometry.mjs';
const record=(id,object,enabled=true)=>({id,type:'procedural-mesh',object,collision:{domainId:'flame-field',enabled}});
const mesh=()=>new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5),new THREE.MeshBasicMaterial());
test('chosen obstacles supply actual world triangles without reparenting or changing source geometry',()=>{
 const parent=new THREE.Group(),a=mesh(),b=mesh();parent.position.set(.5,1,.25);parent.scale.set(2,1,1);parent.add(a);a.position.x=.25;b.position.set(-.5,0,0);
 const collection=createSceneColliderCollection(THREE),first=collection.update([record('a',a),record('b',b,false)]);
 assert.deepEqual(first.memberIds,['a']);assert.equal(first.object.children.length,1);assert.equal(a.parent,parent);
 assert.equal(first.objects[0].object.children[0].geometry,a.geometry);assert.deepEqual(trianglesFromSceneObject(first.object).triangles,trianglesFromSceneObject(a).triangles);
 const before=sceneSolidRevision(first.object);const second=collection.update([record('a',a),record('b',b,false)]);
 assert.equal(second.object,first.object);assert.equal(sceneSolidRevision(second.object),before,'unchanged membership/materials must retain the geometry revision');
 a.position.x=.5;collection.update([record('a',a)]);assert.notEqual(sceneSolidRevision(first.object),before);assert.equal(a.parent,parent);
});
test('multiple marked objects remain distinct meshes and hidden or editor helpers do not enter the mask',()=>{
 const a=mesh(),b=mesh(),helper=mesh();a.add(helper);helper.userData.kaminosEditorHelper=true;
 const collection=createSceneColliderCollection(THREE),both=collection.update([record('a',a),record('b',b)]);
 assert.deepEqual(both.memberIds,['a','b']);assert.equal(both.object.children.length,2);assert.equal(trianglesFromSceneObject(both.object).triangles.length,24);
 b.visible=false;assert.deepEqual(collection.update([record('a',a),record('b',b)]).memberIds,['a']);
 assert.equal(collection.update([record('a',a,false)]),null);assert.equal(collection.state().meshCount,0);assert.equal(a.geometry.getAttribute('position').count,24);
});
test('editing a primitive material preserves the exact collision geometry',()=>{
 const shape=createProceduralMesh(THREE,null,{kind:'box',parameters:{width:1,height:1,depth:1}}),before=sceneSolidRevision(shape.group);
 shape.updateSurface({color:'#112233',roughness:.2,metalness:.7});
 assert.equal(shape.group.material.color.getHexString(),'112233');assert.equal(shape.group.material.roughness,.2);assert.equal(sceneSolidRevision(shape.group),before);
 shape.dispose();
});

test('stunt-double collider consumer substitutes within-voxel-tolerance LOD rungs, supports vertex warps and repetition copies, and preserves open kiln chamber in voxelizeTriangleSolid', async () => {
  const {voxelizeTriangleSolid} = await import('../volume-scene-solid.mjs');
  const {createGiProxyRegistry} = await import('../scene-gi-proxies.mjs');
  const {createRepetitionView} = await import('../scene-repetition.mjs');

  const KILN_HERO = 'a'.repeat(64);
  const KILN_5K = 'b'.repeat(64);
  const KILN_1K = 'c'.repeat(64);
  const BEAM_HERO = 'd'.repeat(64);
  const BEAM_500 = 'e'.repeat(64);

  // Build an open-top hollow kiln chamber (outer box [-0.5,0.5]^3 minus inner cavity [-0.3,0.3]x[-0.3,0.5]x[-0.3,0.3])
  // vs a plugged 1k version where the top aperture is capped shut.
  function makeHollowChamberGeometry(subdivisions = 4, {plugged = false} = {}) {
    const g = new THREE.BoxGeometry(0.8, 0.8, 0.8, subdivisions, subdivisions, subdivisions);
    if (!plugged) {
      // Remove top-center faces so the interior is connected to exterior in voxelizeTriangleSolid
      const pos = g.attributes.position;
      const idx = g.index.array;
      const kept = [];
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i], b = idx[i + 1], c = idx[i + 2];
        const ym = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
        if (ym > 0.39) continue; // open top aperture
        kept.push(a, b, c);
      }
      g.setIndex(kept);
    }
    return g;
  }

  const kilnRoot = new THREE.Group();
  kilnRoot.userData.kaminosSceneObject = {id: 'kiln', type: 'glb', source: `/api/read?root=generated-meshes&path=${KILN_HERO}.glb`};
  const kilnHeroMesh = new THREE.Mesh(makeHollowChamberGeometry(24, {plugged: false}), new THREE.MeshStandardMaterial());
  kilnRoot.add(kilnHeroMesh);

  const beamRoot = new THREE.Group();
  beamRoot.position.set(0.3, 0, 0);
  beamRoot.userData.kaminosSceneObject = {id: 'beam', type: 'glb', source: `/api/read?root=generated-meshes&path=${BEAM_HERO}.glb`};
  const beamHeroMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.2, 10, 10, 10), new THREE.MeshStandardMaterial());
  beamRoot.add(beamHeroMesh);

  // Add a repetition copy and a vertex warp to beamRoot
  const repView = createRepetitionView();
  repView.sync(beamRoot, {schema: 'kaminos.repetition.v1', mode: 'line', count: 2, axis: 'y', angle: 360, step: [0, 0.4, 0], space: 'world', center: [0, 0, 0], mirror: [false, false, false]}, {position: [0.3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1]});
  beamRoot.userData.kaminosVertexWarp = pos => {
    const out = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      out[i] = pos[i];
      out[i + 1] = pos[i + 1] + 0.05;
      out[i + 2] = pos[i + 2];
    }
    return out;
  };
  beamRoot.userData.kaminosVertexWarpRevision = 1;

  const kilnLevels = [
    {sha256: KILN_5K, faces: 5000, closed: true, source: `/api/read?root=generated-meshes&path=${KILN_5K}.glb`, error: {diagonal: 1.487, relative: {p95: 0.009, max: 0.025}, levelToSource: {p95: 0.008, max: 0.024}, sourceToLevel: {p95: 0.016, max: 0.038}}},
    {sha256: KILN_1K, faces: 1000, closed: true, source: `/api/read?root=generated-meshes&path=${KILN_1K}.glb`, error: {diagonal: 1.487, relative: {p95: 0.026, max: 0.061}, levelToSource: {p95: 0.019, max: 0.051}, sourceToLevel: {p95: 0.044, max: 0.091}}},
  ];
  const beamLevels = [
    {sha256: BEAM_500, faces: 500, closed: true, source: `/api/read?root=generated-meshes&path=${BEAM_500}.glb`, error: {diagonal: 1.051, relative: {p95: 0.0016, max: 0.013}, levelToSource: {p95: 0.0016, max: 0.014}, sourceToLevel: {p95: 0.0018, max: 0.0086}}},
  ];

  const parseGlb = async bytes => {
    const sha = new TextDecoder().decode(bytes);
    const g = new THREE.Group();
    if (sha === KILN_5K) g.add(new THREE.Mesh(makeHollowChamberGeometry(3, {plugged: false}), new THREE.MeshStandardMaterial()));
    else if (sha === KILN_1K) g.add(new THREE.Mesh(makeHollowChamberGeometry(2, {plugged: true}), new THREE.MeshStandardMaterial()));
    else if (sha === BEAM_500) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.2, 1, 1, 1), new THREE.MeshStandardMaterial()));
    return g;
  };
  const fetchBytes = async url => {
    const m = /([a-f0-9]{64})\.glb/.exec(url);
    return new TextEncoder().encode(m ? m[1] : '').buffer;
  };
  const digest = async bytes => new TextDecoder().decode(bytes);

  const giProxies = createGiProxyRegistry({
    THREE,
    fetchJson: async url => {
      const isKiln = url.includes(KILN_HERO);
      const levels = isKiln ? kilnLevels : beamLevels;
      // Suppose giProxies initially holds the 1k shadow caster for the kiln
      const choice = levels.at(-1);
      return {schema: 'kaminos.lod-set.v0', source: isKiln ? KILN_HERO : BEAM_HERO, levels, choice, withinBudget: true};
    },
    fetchBytes,
    digest,
    parseGlb,
  });

  await giProxies.attach(kilnRoot, {faces: 1000});
  await giProxies.attach(beamRoot, {faces: 500});

  const collection = createSceneColliderCollection(THREE, {
    giProxies,
    fetchBytes,
    parseGlb,
    digest,
    grid: 32,
    domainScale: 1,
    maxVoxelError: 0.85,
    colliderFaceBudget: 50000,
  });

  const records = [
    record('kiln', kilnRoot, true),
    record('beam', beamRoot, true),
  ];

  assert.equal(typeof collection.prepare, 'function', 'collider collection exposes prepare()');
  await collection.prepare(records, {grid: 32, domainScale: 1});

  const out = collection.update(records, {grid: 32, domainScale: 1});
  assert.ok(out, 'collider collection returns active colliders');
  const st = collection.state();
  assert.ok(st.lodBudget, 'collider collection state includes lodBudget receipt');
  assert.equal(st.lodBudget.allocations.kiln.tier, KILN_5K, 'kiln collider selects 5k tier (refusing plugged/pipe-dropping 1k tier)');
  assert.equal(st.lodBudget.allocations.beam.tier, BEAM_500, 'beam collider selects 500-face tier');
  assert.equal(giProxies.get(kilnRoot).effective.sha, KILN_1K, 'collider rung loading does not mutate giProxies shadow-caster selection');

  // Verify hero had more triangles than the stunt-double collider collection
  const heroKilnTris = trianglesFromSceneObject(kilnHeroMesh).triangles.length;
  const colliderKilnObj = out.objects.find(o => o.id === 'kiln').object;
  const colliderKilnExt = trianglesFromSceneObject(colliderKilnObj);
  assert.ok(colliderKilnExt.triangles.length < heroKilnTris, `kiln collider triangles (${colliderKilnExt.triangles.length}) < hero triangles (${heroKilnTris})`);

  // Verify open chamber is preserved in voxelizeTriangleSolid (interiorCellCount === 0, whereas 1k plugged has interiorCellCount > 0)
  const kilnVox = voxelizeTriangleSolid(colliderKilnExt.triangles, 16, 32);
  assert.equal(kilnVox.interiorCellCount, 0, '5k stunt-double collider preserves open kiln chamber without false interior flood-fill');

  // Verify beam has 2 instances (primary + repetition copy) and vertex warp (+0.05 Y) applied
  const colliderBeamObj = out.objects.find(o => o.id === 'beam').object;
  assert.equal(colliderBeamObj.children.length, 2, 'beam collider group has primary stunt-double + 1 repetition copy');
  const beamTris = trianglesFromSceneObject(colliderBeamObj).triangles;
  assert.equal(beamTris.length, 24, '2 instances of 12-triangle 500-tier box = 24 triangles (down from 2,400 hero triangles)');
  let maxBeamY = -Infinity;
  for (const tri of beamTris) for (const v of tri) if (v[1] > maxBeamY) maxBeamY = v[1];
  assert.ok(Math.abs(maxBeamY - (0.4 + 0.1 + 0.05)) < 1e-5, `beam repetition + vertex warp applied to stunt-double collider (maxY=${maxBeamY})`);

  // Verify rigid transform keeps wrapper THREE.Mesh references stable (for GPU resident solid mesh reuse)
  const firstKilnWrapper = colliderKilnObj.children[0];
  kilnRoot.position.set(0.25, 0, 0);
  kilnRoot.updateMatrixWorld(true);
  const outMoved = collection.update(records, {grid: 32, domainScale: 1});
  const movedKilnObj = outMoved.objects.find(o => o.id === 'kiln').object;
  assert.equal(movedKilnObj.children[0], firstKilnWrapper, 'rigid obstacle translation preserves wrapper Mesh reference for GPU buffer reuse');

  // Verify borrowing an already-warped resident beauty rung resets to kaminosWarpBase (never double-warping)
  const preWarpedRung = new THREE.Group();
  const preWarpedGeom = new THREE.BoxGeometry(0.6, 0.2, 0.2, 1, 1, 1);
  const basePos = new Float32Array(preWarpedGeom.attributes.position.array);
  preWarpedGeom.userData.kaminosWarpBase = basePos;
  const posArr = preWarpedGeom.attributes.position.array;
  for (let i = 1; i < posArr.length; i += 3) posArr[i] += 0.05; // already warped once by beautyLods
  preWarpedGeom.attributes.position.needsUpdate = true;
  preWarpedGeom.userData.kaminosWarpRevision = 1;
  preWarpedRung.add(new THREE.Mesh(preWarpedGeom, new THREE.MeshStandardMaterial()));

  const beautyBorrowCollection = createSceneColliderCollection(THREE, {
    giProxies: {get: root => root === beamRoot ? {...giProxies.get(beamRoot), effective: {sha: 'other'}} : null},
    beautyLods: {
      getResidentRung: (root, sha) => (root === beamRoot && sha === BEAM_500) ? preWarpedRung : null,
    },
  });
  const borrowedOut = beautyBorrowCollection.update([record('beam', beamRoot, true)], {grid: 32, domainScale: 1});
  const borrowedTris = trianglesFromSceneObject(borrowedOut.objects[0].object).triangles;
  let maxBorrowedY = -Infinity;
  for (const tri of borrowedTris) for (const v of tri) if (v[1] > maxBorrowedY) maxBorrowedY = v[1];
  assert.ok(Math.abs(maxBorrowedY - (0.4 + 0.1 + 0.05)) < 1e-5, `borrowing already-warped beauty rung does not double-warp (maxY=${maxBorrowedY})`);
});

test('real Refractory Kiln (f8e6ce91) and Weathered Timber Beam (7be0be28) GLB ladders voxelize accurately via default parseUntexturedColliderGlb', async t => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const meshesDir = '/Users/noahlyons/.local/state/kaminos/assets/generated-meshes';
  const KILN_SHA = 'f8e6ce918e3e5cf234d186724dc21b40b3f9cf7cbc9e776000cf55f24801c91b';
  const BEAM_SHA = '7be0be2857ce5100ffa86f329e4068ba83ebb701c8582e2f982d28e68b8f8bdd';
  const kilnLodsPath = path.join(meshesDir, `.${KILN_SHA}.glb.lods.json`);
  const beamLodsPath = path.join(meshesDir, `.${BEAM_SHA}.glb.lods.json`);
  if (!fs.existsSync(kilnLodsPath) || !fs.existsSync(beamLodsPath)) {
    t.skip('local generated-meshes lods.json not present');
    return;
  }
  const {parseUntexturedColliderGlb} = await import('../scene-collider.mjs');
  const {createGiProxyRegistry} = await import('../scene-gi-proxies.mjs');
  const {voxelizeTriangleSolid} = await import('../volume-scene-solid.mjs');

  const kilnGen = JSON.parse(fs.readFileSync(kilnLodsPath, 'utf8'));
  const beamGen = JSON.parse(fs.readFileSync(beamLodsPath, 'utf8'));
  if (!kilnGen?.levels?.length || !beamGen?.levels?.length) {
    t.skip('kiln/beam levels not populated in lods.json');
    return;
  }

  const readGlbBytes = sha => {
    const buf = fs.readFileSync(path.join(meshesDir, `${sha}.glb`));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };

  // Use lightweight 25k/10k proxies as hero stand-ins so test stays <100ms while exercising real GLB rungs
  const kiln25kSha = kilnGen.levels.find(l => l.faces === 25000).sha256;
  const beam10kSha = beamGen.levels.find(l => l.faces === 10000).sha256;
  const kiln5kSha = kilnGen.levels.find(l => l.faces === 5000).sha256;
  const beam500Sha = beamGen.levels.find(l => l.faces === 500).sha256;

  const kilnRoot = parseUntexturedColliderGlb(THREE, readGlbBytes(kiln25kSha));
  kilnRoot.userData.kaminosSceneObject = {source: `/api/read?root=generated-meshes&path=${KILN_SHA}.glb`};
  kilnRoot.updateMatrixWorld(true);

  const beamRoot = parseUntexturedColliderGlb(THREE, readGlbBytes(beam10kSha));
  beamRoot.userData.kaminosSceneObject = {source: `/api/read?root=generated-meshes&path=${BEAM_SHA}.glb`};
  beamRoot.updateMatrixWorld(true);

  const fetchBytes = async url => {
    const m = /([a-f0-9]{64})\.glb/.exec(url);
    return readGlbBytes(m[1]);
  };
  const giProxies = createGiProxyRegistry({
    THREE,
    fetchJson: async url => {
      const isKiln = url.includes(KILN_SHA);
      const gen = isKiln ? kilnGen : beamGen;
      const levels = gen.levels.map(l => ({...l, source: `/api/read?root=generated-meshes&path=${l.sha256}.glb`}));
      return {schema: 'kaminos.lod-set.v0', source: isKiln ? KILN_SHA : BEAM_SHA, levels, choice: levels.at(-1), withinBudget: true};
    },
    fetchBytes,
    parseGlb: async bytes => parseUntexturedColliderGlb(THREE, bytes),
  });

  await giProxies.attach(kilnRoot, {faces: 1000});
  await giProxies.attach(beamRoot, {faces: 500});

  // Note: we deliberately omit parseGlb on createSceneColliderCollection so it exercises default parseUntexturedColliderGlb!
  const collection = createSceneColliderCollection(THREE, {
    giProxies,
    fetchBytes,
    grid: 32,
    domainScale: 1,
    maxVoxelError: 0.85,
    colliderFaceBudget: 50000,
  });

  const recs = [record('kiln', kilnRoot, true), record('beam', beamRoot, true)];
  await collection.prepare(recs, {grid: 32, domainScale: 1});
  const out = collection.update(recs, {grid: 32, domainScale: 1});
  const st = collection.state();

  assert.equal(st.lodBudget.allocations.kiln.tier, kiln5kSha, 'real Refractory Kiln selects 5,000-face rung');
  assert.equal(st.lodBudget.allocations.beam.tier, beam500Sha, 'real Weathered Timber Beam selects 500-face rung');
  assert.equal(st.triangleCount, 5500, `real kiln (5,000 tier) + beam (500 tier) = 5,500 collider triangles (got ${st.triangleCount})`);

  const kilnTris = trianglesFromSceneObject(out.objects.find(o => o.id === 'kiln').object).triangles;
  assert.equal(kilnTris.length, 5000, 'real 5,000-face Refractory Kiln rung has 5,000 triangles');
  const kilnVox = voxelizeTriangleSolid(kilnTris, 32, 64);
  assert.equal(kilnVox.interiorCellCount, 0, 'real 5,000-face Refractory Kiln rung keeps open chamber (interiorCellCount === 0)');
  assert.ok(kilnVox.surfaceCellCount > 1300, `real 5,000-face Refractory Kiln rung preserves >1300 surface cells (got ${kilnVox.surfaceCellCount})`);
});



