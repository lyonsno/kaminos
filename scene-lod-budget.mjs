// Screen-footprint LOD selection, scene beauty face budgets, decoupled flame-domain shadow caster budgets,
// and the resident beauty rung controller.
//
// Design contracts (operator-ratified, 2026-11-01):
// 1. Texel magnification alongside geometric error (flat-surface blur guard):
//      pixelError(tier) = worldDiag * pixelsPerUnit * max(error.relative[stat], texelWeight * texelSize)
// 2. Decoupled camera beauty LODs vs flame-domain solid-angle shadow caster LODs:
//      - Beauty LODs switch per-frame from camera screen footprint, counting only in-frustum objects against
//        the beauty faceBudget and pinning active polyEdit / sceneComponents objects to 'hero'.
//      - Shadow caster LODs allocate their shadowFaceBudget by solid angle from the flame domain, completely
//        invariant to camera orbit so camera motion never triggers smoke-visibility BVH rebuilds.
// 3. Closest bounding-box surface distance (worldBox.distanceToPoint(cameraPos)) rather than object center.
// 4. Hysteresis deadband (+/-15% around maxPixelError, plus 1.15x stickiness on the active tier during greedy
//    budget demotion).
// 5. Resident rung cache & non-blocking transitions: parsed beauty rungs stay cached per scene object while in
//    the scene, never blank an object while a newly requested tier is still loading, route through surfaceLighting,
//    and restore the hero during fireShadowCasters.withCapture / withHeroes.
// 6. Repetition multiplicity (N * faces): repeated objects (kaminosRepetitionCopy) weight face savings by N * faces
//    and evaluate screen footprint at their closest in-frustum instance.

import {readSurfelGLBExtension, attachStoredSurfelLevels} from './trellis-surfels.mjs';

const digestHex = async bytes =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

const disposeTree = root => {
  if (!root) return;
  const seen = new Set();
  const once = r => {
    if (r && !seen.has(r)) {
      seen.add(r);
      r.dispose?.();
    }
  };
  root.traverse(m => {
    if (!m.isMesh) return;
    once(m.geometry);
    for (const a of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!a || seen.has(a)) continue;
      for (const v of Object.values(a)) if (v?.isTexture) once(v);
      once(a);
    }
  });
};

function vec3Array(v) {
  if (!v) return [0, 0, 0];
  if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  return [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
}

function normalizeBox(box) {
  if (!box) return {min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5]};
  return {min: vec3Array(box.min), max: vec3Array(box.max)};
}

function boxDiagonal(box) {
  const {min, max} = normalizeBox(box);
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
}

function boxDistanceToPoint(box, point) {
  const {min, max} = normalizeBox(box);
  const dx = Math.max(0, min[0] - point[0], point[0] - max[0]);
  const dy = Math.max(0, min[1] - point[1], point[1] - max[1]);
  const dz = Math.max(0, min[2] - point[2], point[2] - max[2]);
  return Math.hypot(dx, dy, dz);
}

function boxDistanceToBox(boxA, boxB) {
  const a = normalizeBox(boxA), b = normalizeBox(boxB);
  const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const dy = Math.max(0, a.min[1] - b.max[1], b.min[1] - a.max[1]);
  const dz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.hypot(dx, dy, dz);
}

function cameraWorldPosition(camera) {
  const e = camera?.matrixWorld?.elements;
  if (e && e.length === 16 && (e[12] !== 0 || e[13] !== 0 || e[14] !== 0 || !camera?.position)) {
    return [e[12], e[13], e[14]];
  }
  return vec3Array(camera?.position);
}

function multiplyMat4(a, b) {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function extractFrustumPlanes(camera) {
  const proj = camera?.projectionMatrix?.elements;
  const view = camera?.matrixWorldInverse?.elements;
  if (!proj || !view) return null;
  const m = multiplyMat4(proj, view);
  const raw = [
    [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
    [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
    [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],
    [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
  ];
  return raw.map(([nx, ny, nz, w]) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l, w / l];
  });
}

function boxIntersectsFrustum(box, planes) {
  if (!planes) return true;
  const {min, max} = normalizeBox(box);
  for (const [nx, ny, nz, w] of planes) {
    const px = nx >= 0 ? max[0] : min[0];
    const py = ny >= 0 ? max[1] : min[1];
    const pz = nz >= 0 ? max[2] : min[2];
    if (nx * px + ny * py + nz * pz + w < 0) return false;
  }
  return true;
}

export function effectiveRelativeGeomError(tier, {stat = 'p95', tailWeight = 0.5, creviceAllowance = 0.005} = {}) {
  const err = tier?.error;
  if (!err) return 0;
  const baseRel = Number(err.relative?.[stat] ?? err.relative?.p95 ?? 0) || 0;
  if (stat !== 'p95') return baseRel;
  const diag = Number(err.diagonal) > 0 ? Number(err.diagonal) : 0;
  if (!(diag > 0)) return baseRel;
  const rawSrcP95 = Number(err.sourceToLevel?.p95);
  const srcP95 = Number.isFinite(rawSrcP95) && rawSrcP95 >= 0 ? rawSrcP95 / diag : 0;
  const rawSrcMax = Number(err.sourceToLevel?.max);
  const rawLvlMax = Number(err.levelToSource?.max);
  const srcMax = Number.isFinite(rawSrcMax) && rawSrcMax >= 0 ? rawSrcMax / diag : 0;
  const lvlMax = Number.isFinite(rawLvlMax) && rawLvlMax >= 0 ? rawLvlMax / diag : 0;
  const allowance = Number.isFinite(Number(creviceAllowance)) ? Math.max(0, Number(creviceAllowance)) : 0.005;
  const weight = Number.isFinite(Number(tailWeight)) ? Math.max(0, Number(tailWeight)) : 0.5;
  const droppedFeatureExcess = Math.max(0, srcMax - lvlMax - allowance);
  return Math.max(baseRel, srcP95) + weight * droppedFeatureExcess;
}

export function screenPixelError(tier, {worldBox, worldDiag, camera, viewportHeight = 1080, stat = 'p95', texelWeight = 0.5, texelStretch = 1, tailWeight = 0.5, creviceAllowance = 0.005} = {}) {
  if (!tier || tier === 'hero' || tier.isHero) return 0;
  const camPos = cameraWorldPosition(camera);
  const near = Math.max(camera?.near ?? 0.01, 1e-6);
  const d = Math.max(boxDistanceToPoint(worldBox, camPos), near);
  const height = Math.max(Number(viewportHeight) || 1080, 1);
  let pixelsPerUnit;
  if (camera?.isOrthographicCamera) {
    const span = Math.max((camera.top ?? 1) - (camera.bottom ?? -1), 1e-6);
    pixelsPerUnit = (height * (camera.zoom ?? 1)) / span;
  } else {
    const projY = camera?.projectionMatrix?.elements?.[5] ?? (1 / Math.tan(((camera?.fov ?? 50) * Math.PI) / 360));
    pixelsPerUnit = (height * 0.5 * projY) / d;
  }
  const diag = Number.isFinite(worldDiag) && worldDiag > 0 ? worldDiag : boxDiagonal(worldBox);
  const stretch = Math.max(1, Number(texelStretch) || 1);
  const geomRel = effectiveRelativeGeomError(tier, {stat, tailWeight, creviceAllowance});
  const texelSize = (Number(tier.normalMap?.texelSize ?? (tier.textureSize > 0 ? 1 / tier.textureSize : 0)) || 0) * stretch;
  const combinedRel = Math.max(geomRel, texelWeight * texelSize);
  return diag * pixelsPerUnit * combinedRel;
}

export function selectFootprintTier(levels = [], {
  heroFaces = Infinity,
  worldBox,
  worldDiag,
  camera,
  viewportHeight = 1080,
  maxPixelError = 1.5,
  stat = 'p95',
  texelWeight = 0.5,
  texelStretch = 1,
  tailWeight = 0.5,
  creviceAllowance = 0.005,
  activeTier = null,
  hysteresis = 0.15,
} = {}) {
  const sorted = [...(levels ?? [])]
    .filter(l => Number.isFinite(l?.faces) && l.faces > 0 && (!Number.isFinite(heroFaces) || l.faces < heroFaces))
    .sort((a, b) => b.faces - a.faces);
  const rungs = [
    {id: 'hero', sha: 'hero', isHero: true, faces: heroFaces, pixelError: 0, geomPixelError: 0, level: null},
    ...sorted.map(l => {
      const id = l.sha ?? l.sha256;
      return {
        id,
        sha: id,
        isHero: false,
        faces: l.faces,
        pixelError: screenPixelError(l, {worldBox, worldDiag, camera, viewportHeight, stat, texelWeight, texelStretch, tailWeight, creviceAllowance}),
        geomPixelError: screenPixelError(l, {worldBox, worldDiag, camera, viewportHeight, stat, texelWeight: 0, texelStretch, tailWeight, creviceAllowance}),
        level: l,
      };
    }),
  ];
  for (let i = 1; i < rungs.length; i++) {
    if (rungs[i].geomPixelError < rungs[i - 1].geomPixelError) {
      rungs[i].geomPixelError = rungs[i - 1].geomPixelError;
    }
    if (rungs[i].pixelError < rungs[i - 1].pixelError) {
      rungs[i].pixelError = rungs[i - 1].pixelError;
    }
  }
  const prevIdx = activeTier != null ? rungs.findIndex(r => r.id === activeTier) : -1;
  const coarsenLimit = maxPixelError * (1 - hysteresis);
  const refineLimit = maxPixelError * (1 + hysteresis);
  let chosenIndex = 0;
  if (prevIdx < 0) {
    for (let i = rungs.length - 1; i >= 0; i--) {
      if (rungs[i].pixelError <= maxPixelError) {
        chosenIndex = i;
        break;
      }
    }
  } else {
    let coarsened = -1;
    for (let i = rungs.length - 1; i > prevIdx; i--) {
      if (rungs[i].pixelError <= coarsenLimit) {
        coarsened = i;
        break;
      }
    }
    if (coarsened >= 0) {
      chosenIndex = coarsened;
    } else if (rungs[prevIdx].pixelError > refineLimit) {
      chosenIndex = 0;
      for (let i = prevIdx - 1; i >= 0; i--) {
        if (rungs[i].pixelError <= maxPixelError) {
          chosenIndex = i;
          break;
        }
      }
    } else {
      chosenIndex = prevIdx;
    }
  }
  return {selected: rungs[chosenIndex], chosenIndex, rungs};
}

export function allocateSceneBeautyLods(candidates = [], {
  camera,
  viewportHeight = 1080,
  maxPixelError = 1.5,
  faceBudget = Infinity,
  stat = 'p95',
  texelWeight = 0.5,
  tailWeight = 0.5,
  creviceAllowance = 0.005,
  hysteresis = 0.15,
} = {}) {
  const planes = extractFrustumPlanes(camera);
  const camPos = cameraWorldPosition(camera);
  const items = candidates.map((c, order) => {
    const boxes = c.instanceBoxes?.length ? c.instanceBoxes : (c.worldBox ? [c.worldBox] : []);
    const visibleBoxes = boxes.filter(b => boxIntersectsFrustum(b, planes));
    const inFrustum = c.inFrustum != null ? Boolean(c.inFrustum) : (boxes.length === 0 ? true : visibleBoxes.length > 0);
    const instanceCount = Math.max(1, c.instanceCount ?? (inFrustum ? (visibleBoxes.length || boxes.length || 1) : (boxes.length || 1)));
    if (!inFrustum) {
      const sorted = [...(c.levels ?? [])].filter(l => Number.isFinite(l?.faces)).sort((a, b) => b.faces - a.faces);
      const coarsest = sorted.at(-1);
      const tierId = c.activeTier ?? (coarsest ? (coarsest.sha ?? coarsest.sha256) : 'hero');
      return {
        id: c.id ?? String(order),
        order,
        inFrustum: false,
        pinned: Boolean(c.pinned),
        instanceCount,
        heroFaces: c.heroFaces ?? 0,
        activeTier: c.activeTier ?? null,
        footprintTier: c.footprintTier ?? tierId,
        rungs: [{id: tierId, sha: tierId, faces: coarsest?.faces ?? c.heroFaces ?? 0, pixelError: 0}],
        chosenIndex: 0,
        demotedByBudget: false,
      };
    }
    let closestBox = visibleBoxes[0] ?? boxes[0] ?? {min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5]};
    let minDist = boxDistanceToPoint(closestBox, camPos);
    for (let i = 1; i < visibleBoxes.length; i++) {
      const d = boxDistanceToPoint(visibleBoxes[i], camPos);
      if (d < minDist) {
        minDist = d;
        closestBox = visibleBoxes[i];
      }
    }
    const diag = c.worldDiag ?? boxDiagonal(closestBox);
    const {rungs, chosenIndex} = selectFootprintTier(c.levels ?? [], {
      heroFaces: c.heroFaces,
      worldBox: closestBox,
      worldDiag: diag,
      camera,
      viewportHeight,
      maxPixelError,
      stat,
      texelWeight,
      texelStretch: c.texelStretch ?? 1,
      tailWeight,
      creviceAllowance,
      activeTier: c.footprintTier ?? c.activeTier,
      hysteresis,
    });
    const effectiveFootprintIdx = c.pinned ? 0 : chosenIndex;
    return {
      id: c.id ?? String(order),
      order,
      inFrustum: true,
      pinned: Boolean(c.pinned),
      instanceCount,
      heroFaces: c.heroFaces,
      activeTier: c.activeTier ?? null,
      footprintTier: rungs[effectiveFootprintIdx].id,
      rungs,
      chosenIndex: effectiveFootprintIdx,
      demotedByBudget: false,
    };
  });

  let totalFaces = 0;
  let heroFacesTotal = 0;
  for (const item of items) {
    if (!item.inFrustum) continue;
    totalFaces += item.instanceCount * item.rungs[item.chosenIndex].faces;
    heroFacesTotal += item.instanceCount * item.heroFaces;
  }

  while (Number.isFinite(faceBudget) && totalFaces > faceBudget) {
    let bestItem = null;
    let bestCost = Infinity;
    let bestDeltaFaces = -1;
    for (const item of items) {
      if (!item.inFrustum || item.pinned || item.chosenIndex >= item.rungs.length - 1) continue;
      const cur = item.rungs[item.chosenIndex];
      const next = item.rungs[item.chosenIndex + 1];
      const deltaFaces = item.instanceCount * (cur.faces - next.faces);
      if (deltaFaces <= 0) continue;
      const deltaTexOrGeom = Math.max(0, next.pixelError - cur.pixelError);
      const deltaGeomOnly = Math.max(0, (next.geomPixelError ?? 0) - (cur.geomPixelError ?? 0));
      const deltaError = deltaTexOrGeom + deltaGeomOnly;
      const stickiness = cur.id === item.activeTier ? 1 + hysteresis : 1;
      const cost = (deltaError / deltaFaces) * stickiness;
      if (cost < bestCost - 1e-12 || (Math.abs(cost - bestCost) <= 1e-12 && deltaFaces > bestDeltaFaces)) {
        bestCost = cost;
        bestDeltaFaces = deltaFaces;
        bestItem = item;
      }
    }
    if (!bestItem) break;
    bestItem.chosenIndex++;
    bestItem.demotedByBudget = true;
    totalFaces -= bestDeltaFaces;
  }

  const allocations = {};
  for (const item of items) {
    const rung = item.rungs[item.chosenIndex];
    allocations[item.id] = {
      id: item.id,
      tier: rung.id,
      footprintTier: item.footprintTier,
      faces: rung.faces,
      totalFaces: item.inFrustum ? item.instanceCount * rung.faces : 0,
      instanceCount: item.instanceCount,
      pixelError: rung.pixelError,
      inFrustum: item.inFrustum,
      pinned: item.pinned,
      demotedByBudget: item.demotedByBudget,
    };
  }
  return {
    allocations,
    totalFaces,
    heroFacesTotal,
    faceBudget,
    withinBudget: totalFaces <= faceBudget,
  };
}

export function allocateShadowCasterLods(candidates = [], {
  flameBox = {min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5]},
  shadowFaceBudget = Infinity,
  maxSolidAngleError = 0.015,
  stat = 'p95',
  tailWeight = 0.5,
  creviceAllowance = 0.005,
  hysteresis = 0.15,
} = {}) {
  const items = candidates.map((c, order) => {
    const boxes = c.instanceBoxes?.length ? c.instanceBoxes : (c.worldBox ? [c.worldBox] : [{min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5]}]);
    let minFlameDist = Infinity;
    for (const b of boxes) minFlameDist = Math.min(minFlameDist, boxDistanceToBox(b, flameBox));
    const diag = c.worldDiag ?? boxDiagonal(boxes[0]);
    const dFlame = Math.max(minFlameDist, 0.05 * diag, 1e-3);
    const sorted = [...(c.levels ?? [])]
      .filter(l => Number.isFinite(l?.faces) && l.faces > 0)
      .sort((a, b) => b.faces - a.faces);
    const rungs = sorted.map(l => {
      const id = l.sha ?? l.sha256;
      const rel = effectiveRelativeGeomError(l, {stat, tailWeight, creviceAllowance});
      return {id, sha: id, faces: l.faces, solidAngleError: (diag * rel) / dFlame, level: l};
    });
    for (let i = 1; i < rungs.length; i++) {
      if (rungs[i].solidAngleError < rungs[i - 1].solidAngleError) {
        rungs[i].solidAngleError = rungs[i - 1].solidAngleError;
      }
    }
    const instanceCount = Math.max(1, c.instanceCount ?? (boxes.length || 1));
    if (!rungs.length) {
      return {
        id: c.id ?? String(order),
        instanceCount,
        activeTier: c.activeTier ?? null,
        rungs: [{id: 'original', sha: 'original', faces: c.heroFaces ?? 0, solidAngleError: 0, level: null}],
        chosenIndex: 0,
        demotedByBudget: false,
      };
    }
    const prevIdx = c.activeTier != null ? rungs.findIndex(r => r.id === c.activeTier) : -1;
    const coarsenLimit = maxSolidAngleError * (1 - hysteresis);
    const refineLimit = maxSolidAngleError * (1 + hysteresis);
    let chosenIndex = 0;
    if (prevIdx < 0) {
      for (let i = rungs.length - 1; i >= 0; i--) {
        if (rungs[i].solidAngleError <= maxSolidAngleError) {
          chosenIndex = i;
          break;
        }
      }
    } else {
      let coarsened = -1;
      for (let i = rungs.length - 1; i > prevIdx; i--) {
        if (rungs[i].solidAngleError <= coarsenLimit) {
          coarsened = i;
          break;
        }
      }
      if (coarsened >= 0) chosenIndex = coarsened;
      else if (rungs[prevIdx].solidAngleError > refineLimit) {
        chosenIndex = 0;
        for (let i = prevIdx - 1; i >= 0; i--) {
          if (rungs[i].solidAngleError <= maxSolidAngleError) {
            chosenIndex = i;
            break;
          }
        }
      } else chosenIndex = prevIdx;
    }
    return {
      id: c.id ?? String(order),
      instanceCount,
      activeTier: c.activeTier ?? null,
      rungs,
      chosenIndex,
      demotedByBudget: false,
    };
  });

  let totalFaces = 0;
  for (const item of items) totalFaces += item.instanceCount * item.rungs[item.chosenIndex].faces;

  while (Number.isFinite(shadowFaceBudget) && totalFaces > shadowFaceBudget) {
    let bestItem = null;
    let bestCost = Infinity;
    let bestDeltaFaces = -1;
    for (const item of items) {
      if (item.chosenIndex >= item.rungs.length - 1) continue;
      const cur = item.rungs[item.chosenIndex];
      const next = item.rungs[item.chosenIndex + 1];
      const deltaFaces = item.instanceCount * (cur.faces - next.faces);
      if (deltaFaces <= 0) continue;
      const deltaErr = Math.max(0, next.solidAngleError - cur.solidAngleError);
      const stickiness = cur.id === item.activeTier ? 1 + hysteresis : 1;
      const cost = (deltaErr / deltaFaces) * stickiness;
      if (cost < bestCost - 1e-12 || (Math.abs(cost - bestCost) <= 1e-12 && deltaFaces > bestDeltaFaces)) {
        bestCost = cost;
        bestDeltaFaces = deltaFaces;
        bestItem = item;
      }
    }
    if (!bestItem) break;
    bestItem.chosenIndex++;
    bestItem.demotedByBudget = true;
    totalFaces -= bestDeltaFaces;
  }

  const allocations = {};
  for (const item of items) {
    const rung = item.rungs[item.chosenIndex];
    allocations[item.id] = {
      id: item.id,
      tier: rung.id,
      faces: rung.faces,
      totalFaces: item.instanceCount * rung.faces,
      instanceCount: item.instanceCount,
      solidAngleError: rung.solidAngleError,
      demotedByBudget: item.demotedByBudget,
    };
  }
  return {
    allocations,
    totalFaces,
    shadowFaceBudget,
    withinBudget: totalFaces <= shadowFaceBudget,
  };
}

export function voxelSolidError(tier, {
  worldBox,
  worldDiag,
  voxelSize = null,
  grid = 64,
  domainScale = 1,
  geomStretch = 1,
  stat = 'p95',
  tailWeight = 0.5,
  creviceAllowance = 0.005,
} = {}) {
  if (!tier || tier === 'hero' || tier.isHero) return 0;
  const pitch = Number.isFinite(Number(voxelSize)) && Number(voxelSize) > 0
    ? Number(voxelSize)
    : (2 * Math.max(Number(domainScale) || 1, 1e-6)) / Math.max(Number(grid) || 64, 2);
  const diag = Number.isFinite(worldDiag) && worldDiag > 0 ? worldDiag : boxDiagonal(worldBox);
  const stretch = Math.max(1, Number(geomStretch) || 1);
  const geomRel = effectiveRelativeGeomError(tier, {stat, tailWeight, creviceAllowance});
  return (diag * geomRel * stretch) / pitch;
}

export function selectColliderTier(levels = [], {
  heroFaces = Infinity,
  worldBox,
  worldDiag,
  voxelSize = null,
  grid = 64,
  domainScale = 1,
  maxVoxelError = 0.85,
  requireClosed = true,
  geomStretch = 1,
  stat = 'p95',
  tailWeight = 0.5,
  creviceAllowance = 0.005,
  activeTier = null,
  hysteresis = 0.15,
} = {}) {
  const sorted = [...(levels ?? [])]
    .filter(l =>
      Number.isFinite(l?.faces) &&
      l.faces > 0 &&
      (!Number.isFinite(heroFaces) || l.faces < heroFaces) &&
      (!requireClosed || l.closed !== false)
    )
    .sort((a, b) => b.faces - a.faces);
  const rungs = [
    {id: 'hero', sha: 'hero', isHero: true, faces: heroFaces, voxelError: 0, level: null},
    ...sorted.map(l => {
      const id = l.sha ?? l.sha256;
      return {
        id,
        sha: id,
        isHero: false,
        faces: l.faces,
        voxelError: voxelSolidError(l, {worldBox, worldDiag, voxelSize, grid, domainScale, geomStretch, stat, tailWeight, creviceAllowance}),
        level: l,
      };
    }),
  ];
  for (let i = 1; i < rungs.length; i++) {
    if (rungs[i].voxelError < rungs[i - 1].voxelError) {
      rungs[i].voxelError = rungs[i - 1].voxelError;
    }
  }
  const prevIdx = activeTier != null ? rungs.findIndex(r => r.id === activeTier) : -1;
  const coarsenLimit = maxVoxelError * (1 - hysteresis);
  const refineLimit = maxVoxelError * (1 + hysteresis);
  let chosenIndex = 0;
  if (prevIdx < 0) {
    for (let i = rungs.length - 1; i >= 0; i--) {
      if (rungs[i].voxelError <= maxVoxelError) {
        chosenIndex = i;
        break;
      }
    }
  } else {
    let coarsened = -1;
    for (let i = rungs.length - 1; i > prevIdx; i--) {
      if (rungs[i].voxelError <= coarsenLimit) {
        coarsened = i;
        break;
      }
    }
    if (coarsened >= 0) {
      chosenIndex = coarsened;
    } else if (rungs[prevIdx].voxelError > refineLimit) {
      chosenIndex = 0;
      for (let i = prevIdx - 1; i >= 0; i--) {
        if (rungs[i].voxelError <= maxVoxelError) {
          chosenIndex = i;
          break;
        }
      }
    } else {
      chosenIndex = prevIdx;
    }
  }
  const sel = rungs[chosenIndex];
  return {selected: sel, tier: sel.id, sha: sel.sha, faces: sel.faces, voxelError: sel.voxelError, chosenIndex, rungs};
}

export function allocateColliderLods(candidates = [], {
  voxelSize = null,
  grid = 64,
  domainScale = 1,
  maxVoxelError = 0.85,
  colliderFaceBudget = Infinity,
  requireClosed = true,
  stat = 'p95',
  tailWeight = 0.5,
  creviceAllowance = 0.005,
  hysteresis = 0.15,
} = {}) {
  const pitch = Number.isFinite(Number(voxelSize)) && Number(voxelSize) > 0
    ? Number(voxelSize)
    : (2 * Math.max(Number(domainScale) || 1, 1e-6)) / Math.max(Number(grid) || 64, 2);
  const items = candidates.map((c, order) => {
    const boxes = c.instanceBoxes?.length ? c.instanceBoxes : (c.worldBox ? [c.worldBox] : [{min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5]}]);
    let maxDiag = 0;
    for (const b of boxes) maxDiag = Math.max(maxDiag, boxDiagonal(b));
    const diag = c.worldDiag ?? (maxDiag || 1);
    const instanceCount = Math.max(1, c.instanceCount ?? (boxes.length || 1));
    const {rungs, chosenIndex} = selectColliderTier(c.levels ?? [], {
      heroFaces: c.heroFaces,
      worldBox: boxes[0],
      worldDiag: diag,
      voxelSize: pitch,
      grid,
      domainScale,
      maxVoxelError,
      requireClosed,
      geomStretch: c.geomStretch ?? 1,
      stat,
      tailWeight,
      creviceAllowance,
      activeTier: c.voxelTier ?? c.activeTier ?? null,
      hysteresis,
    });
    const effectiveIdx = c.pinned ? 0 : chosenIndex;
    return {
      id: c.id ?? String(order),
      order,
      pinned: Boolean(c.pinned),
      instanceCount,
      heroFaces: c.heroFaces ?? 0,
      activeTier: c.activeTier ?? null,
      voxelTier: rungs[effectiveIdx].id,
      rungs,
      chosenIndex: effectiveIdx,
      demotedByBudget: false,
    };
  });

  let totalFaces = 0;
  let heroFacesTotal = 0;
  for (const item of items) {
    totalFaces += item.instanceCount * item.rungs[item.chosenIndex].faces;
    heroFacesTotal += item.instanceCount * item.heroFaces;
  }

  while (Number.isFinite(colliderFaceBudget) && totalFaces > colliderFaceBudget) {
    let bestItem = null;
    let bestCost = Infinity;
    let bestDeltaFaces = -1;
    for (const item of items) {
      if (item.pinned || item.chosenIndex >= item.rungs.length - 1) continue;
      const cur = item.rungs[item.chosenIndex];
      const next = item.rungs[item.chosenIndex + 1];
      const deltaFaces = item.instanceCount * (cur.faces - next.faces);
      if (deltaFaces <= 0) continue;
      const deltaError = Math.max(0, next.voxelError - cur.voxelError);
      const stickiness = cur.id === item.activeTier ? 1 + hysteresis : 1;
      const cost = (deltaError / deltaFaces) * stickiness;
      if (cost < bestCost - 1e-12 || (Math.abs(cost - bestCost) <= 1e-12 && deltaFaces > bestDeltaFaces)) {
        bestCost = cost;
        bestDeltaFaces = deltaFaces;
        bestItem = item;
      }
    }
    if (!bestItem) break;
    bestItem.chosenIndex++;
    bestItem.demotedByBudget = true;
    totalFaces -= bestDeltaFaces;
  }

  const allocations = {};
  for (const item of items) {
    const rung = item.rungs[item.chosenIndex];
    allocations[item.id] = {
      id: item.id,
      tier: rung.id,
      voxelTier: item.voxelTier,
      faces: rung.faces,
      totalFaces: item.instanceCount * rung.faces,
      instanceCount: item.instanceCount,
      voxelError: rung.voxelError,
      pinned: item.pinned,
      demotedByBudget: item.demotedByBudget,
    };
  }
  return {
    allocations,
    totalFaces,
    heroFacesTotal,
    colliderFaceBudget,
    maxVoxelError,
    voxelSize: pitch,
    grid,
    domainScale,
    withinBudget: totalFaces <= colliderFaceBudget,
  };
}

function cloneBorrowedRung(THREE, node) {
  const copy = node.isMesh ? new THREE.Mesh(node.geometry, node.userData?.kaminosOriginalMaterial ?? node.material) : new THREE.Group();
  copy.position.copy(node.position);
  copy.quaternion.copy(node.quaternion);
  copy.scale.copy(node.scale);
  copy.matrix.copy(node.matrix);
  copy.matrixAutoUpdate = node.matrixAutoUpdate;
  copy.visible = node.visible;
  copy.castShadow = node.castShadow;
  copy.receiveShadow = node.receiveShadow;
  for (const child of node.children) copy.add(cloneBorrowedRung(THREE, child));
  return copy;
}

function normalizeWarpBounds(bounds) {
  if (!bounds) return null;
  if (Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
    return {min: vec3Array(bounds.min), max: vec3Array(bounds.max)};
  }
  if (bounds.min?.isVector3 || (bounds.min && typeof bounds.min.x === 'number')) {
    return {min: vec3Array(bounds.min), max: vec3Array(bounds.max)};
  }
  if (Number.isFinite(bounds.min) && Number.isFinite(bounds.max)) {
    const xMin = Number.isFinite(bounds.xMin) ? bounds.xMin : -Infinity;
    const xMax = Number.isFinite(bounds.xMax) ? bounds.xMax : Infinity;
    return {min: [xMin, -Infinity, bounds.min], max: [xMax, Infinity, bounds.max]};
  }
  return null;
}

function clampPositionsToBounds(src, bounds) {
  const b = normalizeWarpBounds(bounds);
  if (!b) return src;
  const out = new Float32Array(src.length);
  const [minX, minY, minZ] = b.min;
  const [maxX, maxY, maxZ] = b.max;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = x < minX ? minX : (x > maxX ? maxX : x);
    out[i + 1] = y < minY ? minY : (y > maxY ? maxY : y);
    out[i + 2] = z < minZ ? minZ : (z > maxZ ? maxZ : z);
  }
  return out;
}

function arrayBounds(pos) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      if (pos[i + c] < min[c]) min[c] = pos[i + c];
      if (pos[i + c] > max[c]) max[c] = pos[i + c];
    }
  }
  return min[0] <= max[0] ? {min, max} : {min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5]};
}

export function applyRootVertexWarpToRung(THREE, rungRoot, warpFn, {bounds = null} = {}) {
  if (!rungRoot) return {ok: false, error: 'missing rungRoot', maxStretch: 1, texelStretch: 1};
  if (!rungRoot.userData) rungRoot.userData = {};
  rungRoot.updateMatrixWorld?.(true);
  const invRung = new THREE.Matrix4().copy(rungRoot.matrixWorld).invert();
  const meshToRoot = new THREE.Matrix4();
  const rootToMesh = new THREE.Matrix4();
  const normalMeshToRoot = new THREE.Matrix3();
  const normalRootToMesh = new THREE.Matrix3();
  const v3 = new THREE.Vector3();
  const n0 = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const t0 = new THREE.Vector3();
  const qRot = new THREE.Quaternion();

  const seenGeometries = new Set();
  const meshes = [];
  const visit = node => {
    if (!node) return;
    if (
      node !== rungRoot &&
      (node.userData?.kaminosRepetitionCopy ||
        node.userData?.kaminosBeautyLodProxy ||
        node.userData?.kaminosEditorHelper ||
        node.userData?.kaminosEditorOnly)
    ) {
      return;
    }
    if (node.isMesh && node.geometry && !seenGeometries.has(node.geometry)) {
      seenGeometries.add(node.geometry);
      meshes.push(node);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(rungRoot);

  const unwarpedMin = [Infinity, Infinity, Infinity];
  const unwarpedMax = [-Infinity, -Infinity, -Infinity];
  const warpedMin = [Infinity, Infinity, Infinity];
  const warpedMax = [-Infinity, -Infinity, -Infinity];
  let maxStretch = 1;
  let lastError = null;
  const effectiveBounds = normalizeWarpBounds(bounds ?? rungRoot.userData?.kaminosVertexWarpBounds ?? null);

  for (const m of meshes) {
    const geom = m.geometry;
    const posAttr = geom.getAttribute('position');
    if (!posAttr?.array) continue;
    const normAttr = geom.getAttribute('normal');
    const tanAttr = geom.getAttribute('tangent');
    meshToRoot.multiplyMatrices(invRung, m.matrixWorld);
    rootToMesh.copy(meshToRoot).invert();
    normalMeshToRoot.getNormalMatrix(meshToRoot);
    normalRootToMesh.getNormalMatrix(rootToMesh);

    if (!geom.userData) geom.userData = {};
    let base = geom.userData.kaminosWarpBase;
    if (!base) {
      const origMeshPos = new Float32Array(posAttr.array);
      const origMeshNorm = normAttr?.array ? new Float32Array(normAttr.array) : null;
      const origMeshTan = tanAttr?.array ? new Float32Array(tanAttr.array) : null;
      const rootPos = new Float32Array(origMeshPos.length);
      for (let i = 0; i < origMeshPos.length; i += 3) {
        v3.set(origMeshPos[i], origMeshPos[i + 1], origMeshPos[i + 2]).applyMatrix4(meshToRoot);
        rootPos[i] = v3.x;
        rootPos[i + 1] = v3.y;
        rootPos[i + 2] = v3.z;
      }
      let rootNorm = null;
      if (origMeshNorm) {
        rootNorm = new Float32Array(origMeshNorm.length);
        for (let i = 0; i < origMeshNorm.length; i += 3) {
          v3.set(origMeshNorm[i], origMeshNorm[i + 1], origMeshNorm[i + 2]).applyMatrix3(normalMeshToRoot).normalize();
          rootNorm[i] = v3.x;
          rootNorm[i + 1] = v3.y;
          rootNorm[i + 2] = v3.z;
        }
      }
      const rootBounds = arrayBounds(rootPos);
      base = {origMeshPos, origMeshNorm, origMeshTan, rootPos, rootNorm, rootBounds};
      geom.userData.kaminosWarpBase = base;
    }
    for (let c = 0; c < 3; c++) {
      if (base.rootBounds.min[c] < unwarpedMin[c]) unwarpedMin[c] = base.rootBounds.min[c];
      if (base.rootBounds.max[c] > unwarpedMax[c]) unwarpedMax[c] = base.rootBounds.max[c];
    }

    const restoreMeshToBase = () => {
      if (geom.userData.kaminosWarpApplied) {
        posAttr.array.set(base.origMeshPos);
        posAttr.needsUpdate = true;
        if (normAttr && base.origMeshNorm) {
          normAttr.array.set(base.origMeshNorm);
          normAttr.needsUpdate = true;
        }
        if (tanAttr && base.origMeshTan) {
          tanAttr.array.set(base.origMeshTan);
          tanAttr.needsUpdate = true;
        }
        geom.computeBoundingBox?.();
        geom.computeBoundingSphere?.();
        geom.userData.kaminosWarpApplied = false;
      }
    };

    if (typeof warpFn !== 'function') {
      restoreMeshToBase();
      continue;
    }

    let res = null;
    let inputPos = effectiveBounds ? clampPositionsToBounds(base.rootPos, effectiveBounds) : base.rootPos;
    try {
      res = warpFn(inputPos, base.rootNorm);
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (/outside fitted (longitudinal profile|cross-section)/i.test(msg)) {
        const rb = base.rootBounds;
        const marginX = (rb.max[0] - rb.min[0]) * 0.005;
        const marginZ = (rb.max[2] - rb.min[2]) * 0.005;
        const insetBounds = {
          min: [rb.min[0] + marginX, rb.min[1], rb.min[2] + marginZ],
          max: [rb.max[0] - marginX, rb.max[1], rb.max[2] - marginZ],
        };
        inputPos = clampPositionsToBounds(base.rootPos, effectiveBounds ?? insetBounds);
        try {
          res = warpFn(inputPos, base.rootNorm);
        } catch (err2) {
          lastError = String(err2?.message ?? err2);
          restoreMeshToBase();
          continue;
        }
      } else {
        lastError = msg;
        restoreMeshToBase();
        continue;
      }
    }

    const warpedRootPos = res?.positions ?? res;
    const warpedRootNorm = res?.normals ?? null;
    if (!(warpedRootPos instanceof Float32Array) || warpedRootPos.length !== base.rootPos.length) {
      lastError = 'warpFn must return a matching Float32Array of positions';
      restoreMeshToBase();
      continue;
    }

    const reportedStretch = Number(res?.metrics?.maxAxialStretch ?? res?.maxStretch);
    if (Number.isFinite(reportedStretch) && reportedStretch > maxStretch) maxStretch = reportedStretch;
    const wb = arrayBounds(warpedRootPos);
    for (let c = 0; c < 3; c++) {
      if (wb.min[c] < warpedMin[c]) warpedMin[c] = wb.min[c];
      if (wb.max[c] > warpedMax[c]) warpedMax[c] = wb.max[c];
    }

    const dstPos = posAttr.array;
    for (let i = 0; i < warpedRootPos.length; i += 3) {
      v3.set(warpedRootPos[i], warpedRootPos[i + 1], warpedRootPos[i + 2]).applyMatrix4(rootToMesh);
      dstPos[i] = v3.x;
      dstPos[i + 1] = v3.y;
      dstPos[i + 2] = v3.z;
    }
    posAttr.needsUpdate = true;

    if (normAttr) {
      if (warpedRootNorm instanceof Float32Array && warpedRootNorm.length === normAttr.array.length) {
        const dstNorm = normAttr.array;
        for (let i = 0; i < warpedRootNorm.length; i += 3) {
          v3.set(warpedRootNorm[i], warpedRootNorm[i + 1], warpedRootNorm[i + 2]).applyMatrix3(normalRootToMesh).normalize();
          dstNorm[i] = v3.x;
          dstNorm[i + 1] = v3.y;
          dstNorm[i + 2] = v3.z;
        }
        normAttr.needsUpdate = true;
      } else {
        geom.computeVertexNormals?.();
      }
    }

    if (tanAttr && base.origMeshTan) {
      const dstTan = tanAttr.array;
      const dstNorm = normAttr?.array ?? null;
      const count = posAttr.count;
      for (let v = 0; v < count; v++) {
        const i3 = v * 3;
        const i4 = v * 4;
        t0.set(base.origMeshTan[i4], base.origMeshTan[i4 + 1], base.origMeshTan[i4 + 2]);
        if (dstNorm) {
          n1.set(dstNorm[i3], dstNorm[i3 + 1], dstNorm[i3 + 2]).normalize();
          if (base.origMeshNorm) {
            n0.set(base.origMeshNorm[i3], base.origMeshNorm[i3 + 1], base.origMeshNorm[i3 + 2]).normalize();
            if (n0.dot(n1) > -0.9999) {
              qRot.setFromUnitVectors(n0, n1);
              t0.applyQuaternion(qRot);
            }
          }
          t0.addScaledVector(n1, -t0.dot(n1));
          if (t0.lengthSq() < 1e-10) {
            if (Math.abs(n1.x) < 0.9) t0.set(1, 0, 0).addScaledVector(n1, -n1.x);
            else t0.set(0, 1, 0).addScaledVector(n1, -n1.y);
          }
        }
        t0.normalize();
        dstTan[i4] = t0.x;
        dstTan[i4 + 1] = t0.y;
        dstTan[i4 + 2] = t0.z;
        dstTan[i4 + 3] = base.origMeshTan[i4 + 3];
      }
      tanAttr.needsUpdate = true;
    }

    geom.computeBoundingBox?.();
    geom.computeBoundingSphere?.();
    geom.userData.kaminosWarpApplied = true;
  }

  if (unwarpedMin[0] <= unwarpedMax[0]) {
    rungRoot.userData.kaminosUnwarpedRootBox = {min: unwarpedMin, max: unwarpedMax};
  }
  let texelStretch = 1;
  if (typeof warpFn === 'function' && !lastError && unwarpedMin[0] <= unwarpedMax[0] && warpedMin[0] <= warpedMax[0]) {
    const unwarpedDiag = boxDiagonal({min: unwarpedMin, max: unwarpedMax});
    const warpedDiag = boxDiagonal({min: warpedMin, max: warpedMax});
    texelStretch = Math.max(1, (unwarpedDiag * maxStretch) / Math.max(warpedDiag, 1e-6));
  }
  rungRoot.userData.kaminosVertexWarpError = lastError;
  rungRoot.userData.kaminosVertexWarpMaxStretch = maxStretch;
  rungRoot.userData.kaminosVertexWarpTexelStretch = texelStretch;
  return {ok: !lastError, error: lastError, maxStretch, texelStretch};
}

export function createSceneBeautyLodController({
  THREE,
  scene,
  giProxies,
  surfaceLighting = null,
  fetchBytes = async url => {
    const r = await fetch(url);
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  },
  parseGlb,
  digest = digestHex,
  settings: initialSettings = {},
  onUpdate = null,
}) {
  const config = {
    enabled: true,
    maxPixelError: 1.5,
    faceBudget: 150000,
    texelWeight: 0.5,
    tailWeight: 0.5,
    creviceAllowance: 0.005,
    hysteresis: 0.15,
    stat: 'p95',
    ...initialSettings,
  };
  const entries = new Map();
  const pendingLoads = new Set();
  let disposed = false;
  let lastState = {enabled: config.enabled, totalFaces: 0, heroFacesTotal: 0, faceBudget: config.faceBudget, withinBudget: true, objects: []};

  const isHeroChild = child =>
    !child.userData?.kaminosBeautyLodProxy &&
    !child.userData?.kaminosEditorHelper &&
    !child.userData?.kaminosEditorOnly;

  function inspectHeroRoot(root) {
    let heroFaces = 0;
    const localBox = new THREE.Box3();
    const unwarpedBox = new THREE.Box3();
    const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const scratchMat = new THREE.Matrix4();
    const scratchBox = new THREE.Box3();
    for (const child of root.children) {
      if (!isHeroChild(child) || child.userData?.kaminosRepetitionCopy) continue;
      child.traverse(m => {
        if (!m.isMesh || !m.geometry) return;
        const count = (m.geometry.index?.count ?? m.geometry.attributes?.position?.count ?? 0) / 3;
        heroFaces += count * (m.isInstancedMesh ? m.count : 1);
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox?.();
        if (m.geometry.boundingBox) {
          scratchMat.copy(invRoot).multiply(m.matrixWorld);
          scratchBox.copy(m.geometry.boundingBox).applyMatrix4(scratchMat);
          localBox.union(scratchBox);
        }
        const rb = m.geometry.userData?.kaminosWarpBase?.rootBounds;
        if (rb?.min && rb?.max) {
          unwarpedBox.expandByPoint(new THREE.Vector3(...rb.min));
          unwarpedBox.expandByPoint(new THREE.Vector3(...rb.max));
        }
      });
    }
    if (localBox.isEmpty()) localBox.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    const unwarpedBounds = normalizeWarpBounds(root.userData?.kaminosVertexWarpBounds ?? root.userData?.kaminosUnwarpedRootBox) ??
      (!unwarpedBox.isEmpty()
        ? {min: unwarpedBox.min.toArray(), max: unwarpedBox.max.toArray()}
        : (!root.userData?.kaminosVertexWarp ? {min: localBox.min.toArray(), max: localBox.max.toArray()} : null));
    if (unwarpedBounds && root.userData && !root.userData.kaminosUnwarpedRootBox) {
      root.userData.kaminosUnwarpedRootBox = unwarpedBounds;
    }
    return {
      heroFaces: Math.max(1, Math.round(heroFaces)),
      localBox,
      unwarpedBounds,
      texelStretch: Math.max(1, Number(root.userData?.kaminosVertexWarpTexelStretch) || 1),
    };
  }

  function restoreRootToHero(root, entry) {
    if (!entry) return;
    if (entry.wrapper?.parent === root) root.remove(entry.wrapper);
    for (const [child, vis] of entry.savedHeroVisibility) {
      if (child.parent === root) child.visible = vis;
    }
    entry.savedHeroVisibility.clear();
    delete root.userData.kaminosBeautyLodRestore;
  }

  function releaseRepCopies(entry) {
    for (const holder of entry.repCopies) {
      holder.userData?.kaminosReleaseLighting?.();
      holder.removeFromParent();
    }
    entry.repCopies = [];
  }

  function applyDisplayedRung(root, entry) {
    if (entry.displayedTier === 'hero' || !entry.rungs.has(entry.displayedTier)) {
      restoreRootToHero(root, entry);
      return;
    }
    const rungRecord = entry.rungs.get(entry.displayedTier);
    for (const child of root.children) {
      if (isHeroChild(child)) {
        if (!entry.savedHeroVisibility.has(child)) {
          entry.savedHeroVisibility.set(child, child.visible);
        }
        child.visible = false;
      }
    }
    if (!entry.wrapper || entry.mountedRungSha !== entry.displayedTier) {
      releaseRepCopies(entry);
      if (entry.wrapper?.parent === root) root.remove(entry.wrapper);
      const wrapper = new THREE.Group();
      wrapper.name = `beauty-lod-${entry.displayedTier.slice(0, 8)}`;
      wrapper.userData.kaminosBeautyLodProxy = true;
      wrapper.add(rungRecord.root);
      entry.wrapper = wrapper;
      entry.mountedRungSha = entry.displayedTier;
    }
    const repSources = root.children.filter(c => c.userData?.kaminosRepetitionCopy === true && (entry.savedHeroVisibility.get(c) ?? c.visible));
    while (entry.repCopies.length > repSources.length) {
      const removed = entry.repCopies.pop();
      removed.userData?.kaminosReleaseLighting?.();
      removed.removeFromParent();
    }
    while (entry.repCopies.length < repSources.length) {
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.add(cloneBorrowedRung(THREE, rungRecord.root));
      holder.userData.kaminosReleaseLighting = surfaceLighting?.registerProxyRoot?.(holder) ?? null;
      entry.repCopies.push(holder);
      entry.wrapper.add(holder);
    }
    for (let i = 0; i < repSources.length; i++) {
      entry.repCopies[i].matrix.copy(repSources[i].matrix);
      entry.repCopies[i].matrixWorldNeedsUpdate = true;
    }
    if (entry.wrapper.parent !== root) root.add(entry.wrapper);
    entry.wrapper.visible = true;
    root.userData.kaminosBeautyLodRestore = () => {
      restoreRootToHero(root, entry);
      return () => applyDisplayedRung(root, entry);
    };
  }

  function ensureRungLoaded(root, entry, level) {
    const sha = level?.sha ?? level?.sha256;
    if (!sha || entry.rungs.has(sha) || entry.inFlight.has(sha)) return;
    entry.inFlight.add(sha);
    const gen = entry.generation;
    const url = level.source ?? `/api/read?root=generated-meshes&path=${sha}.glb`;
    const task = (async () => {
      let rungRoot = null;
      try {
        const bytes = await fetchBytes(url);
        if (await digest(bytes) !== sha) throw Error(`beauty LOD content mismatch for ${sha}`);
        rungRoot = await parseGlb(bytes);
        rungRoot.traverse(m => {
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            m.userData.kaminosOriginalMaterial = m.material;
          }
        });
        if (disposed || entries.get(root) !== entry || entry.generation !== gen) {
          disposeTree(rungRoot);
          rungRoot = null;
          return;
        }
        if (typeof entry.warpFn === 'function') {
          const warpRes = applyRootVertexWarpToRung(THREE, rungRoot, entry.warpFn, {bounds: entry.unwarpedBounds});
          if (warpRes.texelStretch > entry.texelStretch) entry.texelStretch = warpRes.texelStretch;
        }
        const releaseLighting = surfaceLighting?.registerProxyRoot?.(rungRoot) ?? null;
        entry.rungs.set(sha, {sha, faces: level.faces, root: rungRoot, releaseLighting, warpFn: entry.warpFn, warpRevision: entry.warpRevision});
        rungRoot = null;
        onUpdate?.();
      } catch {
        if (rungRoot) disposeTree(rungRoot);
      } finally {
        entry.inFlight.delete(sha);
        pendingLoads.delete(task);
      }
    })();
    pendingLoads.add(task);
  }

  function ensureSurfelLevelsLoaded(root, entry, handle) {
    const surfelRoot = handle?.surfels?.root;
    const surfelLevels = handle?.surfelLevels;
    if (!surfelRoot || !surfelLevels?.length || entry.surfelLevelsAttached || entry.surfelLevelsInFlight) return;
    entry.surfelLevelsInFlight = true;
    const gen = entry.generation;
    const task = (async () => {
      try {
        const loaded = [];
        for (const sl of surfelLevels) {
          const sha = sl.sha ?? sl.sha256;
          const url = sl.source ?? `/api/read?root=generated-meshes&path=${sha}.glb`;
          const bytes = await fetchBytes(url);
          if (await digest(bytes) !== sha) continue;
          const {field} = readSurfelGLBExtension(bytes);
          loaded.push({mergeFactor: sl.mergeFactor, field});
        }
        if (disposed || entries.get(root) !== entry || entry.generation !== gen || !loaded.length) return;
        attachStoredSurfelLevels(THREE, surfelRoot, loaded);
        entry.surfelLevelsAttached = true;
        onUpdate?.();
      } catch {
        // Surfel chunk keeps its in-memory [1, 2, 4] pyramid on fetch error
      } finally {
        entry.surfelLevelsInFlight = false;
        pendingLoads.delete(task);
      }
    })();
    pendingLoads.add(task);
  }

  function release(root) {
    const entry = entries.get(root);
    if (!entry) return;
    entry.generation++;
    restoreRootToHero(root, entry);
    releaseRepCopies(entry);
    for (const r of entry.rungs.values()) {
      r.releaseLighting?.();
      disposeTree(r.root);
    }
    entry.rungs.clear();
    entry.inFlight.clear();
    entries.delete(root);
  }

  const unbindGiRelease = giProxies?.onRelease?.(root => release(root)) ?? null;

  return {
    read: () => ({...config}),
    setSettings(patch = {}) {
      if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
      if (Number.isFinite(patch.maxPixelError) && patch.maxPixelError > 0) config.maxPixelError = patch.maxPixelError;
      if (patch.faceBudget === Infinity || (Number.isFinite(patch.faceBudget) && patch.faceBudget > 0)) config.faceBudget = patch.faceBudget;
      if (Number.isFinite(patch.texelWeight) && patch.texelWeight >= 0) config.texelWeight = patch.texelWeight;
      if (Number.isFinite(patch.tailWeight) && patch.tailWeight >= 0) config.tailWeight = patch.tailWeight;
      if (Number.isFinite(patch.creviceAllowance) && patch.creviceAllowance >= 0) config.creviceAllowance = patch.creviceAllowance;
      if (Number.isFinite(patch.hysteresis) && patch.hysteresis >= 0 && patch.hysteresis < 1) config.hysteresis = patch.hysteresis;
      if (['p95', 'max', 'mean'].includes(patch.stat)) config.stat = patch.stat;
      if (!config.enabled) {
        for (const [root, entry] of entries) {
          entry.activeTier = 'hero';
          entry.footprintTier = 'hero';
          entry.displayedTier = 'hero';
          restoreRootToHero(root, entry);
        }
      }
      return {...config};
    },
    update(camera, {viewportHeight = 1080, pinnedObjects = null} = {}) {
      if (disposed || !camera) return lastState;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld?.(true);
      const pinnedSet = pinnedObjects instanceof Set ? pinnedObjects : new Set(Array.isArray(pinnedObjects) ? pinnedObjects : []);
      const handles = giProxies?.list?.() ?? [];
      const seenRoots = new Set();
      const candidates = [];

      for (const handle of handles) {
        const root = handle.root;
        if (!root?.parent) continue;
        seenRoots.add(root);
        let entry = entries.get(root);
        if (!root.visible) {
          if (entry) {
            entry.activeTier = 'hero';
            entry.footprintTier = 'hero';
            entry.displayedTier = 'hero';
            restoreRootToHero(root, entry);
          }
          continue;
        }
        if (!entry) {
          const {heroFaces, localBox, unwarpedBounds, texelStretch} = inspectHeroRoot(root);
          entry = {
            id: root.userData?.kaminosSceneObject?.id ?? root.uuid,
            heroFaces,
            localBox,
            unwarpedBounds,
            texelStretch,
            rungs: new Map(),
            inFlight: new Set(),
            activeTier: 'hero',
            footprintTier: 'hero',
            displayedTier: 'hero',
            mountedRungSha: null,
            wrapper: null,
            repCopies: [],
            savedHeroVisibility: new Map(),
            generation: 1,
            surfelLevelsAttached: false,
            surfelLevelsInFlight: false,
            warpFn: typeof root.userData?.kaminosVertexWarp === 'function' ? root.userData.kaminosVertexWarp : null,
            warpRevision: root.userData?.kaminosVertexWarpRevision ?? 0,
          };
          entries.set(root, entry);
        } else {
          const curWarpFn = typeof root.userData?.kaminosVertexWarp === 'function' ? root.userData.kaminosVertexWarp : null;
          const curWarpRev = root.userData?.kaminosVertexWarpRevision ?? 0;
          if (entry.warpFn !== curWarpFn || entry.warpRevision !== curWarpRev) {
            entry.warpFn = curWarpFn;
            entry.warpRevision = curWarpRev;
            const {heroFaces, localBox, unwarpedBounds, texelStretch} = inspectHeroRoot(root);
            entry.heroFaces = heroFaces;
            entry.localBox = localBox;
            if (unwarpedBounds) entry.unwarpedBounds = unwarpedBounds;
            entry.texelStretch = texelStretch;
            for (const rungRecord of entry.rungs.values()) {
              const warpRes = applyRootVertexWarpToRung(THREE, rungRecord.root, curWarpFn, {bounds: entry.unwarpedBounds});
              if (warpRes.texelStretch > entry.texelStretch) entry.texelStretch = warpRes.texelStretch;
              rungRecord.warpFn = curWarpFn;
              rungRecord.warpRevision = curWarpRev;
            }
          }
        }
        if (handle.representation === 'surfels') {
          ensureSurfelLevelsLoaded(root, entry, handle);
          continue;
        }
        if (!handle.levels?.length) continue;

        const repSources = root.children.filter(c => c.userData?.kaminosRepetitionCopy === true && (entry.savedHeroVisibility.get(c) ?? c.visible));
        const instanceBoxes = [new THREE.Box3().copy(entry.localBox).applyMatrix4(root.matrixWorld)];
        const copyWorldMat = new THREE.Matrix4();
        for (const rep of repSources) {
          copyWorldMat.multiplyMatrices(root.matrixWorld, rep.matrix);
          instanceBoxes.push(new THREE.Box3().copy(entry.localBox).applyMatrix4(copyWorldMat));
        }
        const pinned = pinnedSet.has(root) || pinnedSet.has(entry.id);
        candidates.push({
          id: entry.id,
          root,
          entry,
          handle,
          heroFaces: entry.heroFaces,
          levels: handle.levels,
          instanceBoxes,
          worldDiag: boxDiagonal(instanceBoxes[0]),
          texelStretch: entry.texelStretch,
          pinned,
          activeTier: entry.activeTier,
          footprintTier: entry.footprintTier,
        });
      }

      for (const [root] of entries) {
        if (!seenRoots.has(root)) release(root);
      }

      if (!config.enabled) {
        for (const {root, entry} of candidates) {
          entry.activeTier = 'hero';
          entry.footprintTier = 'hero';
          entry.displayedTier = 'hero';
          restoreRootToHero(root, entry);
        }
        lastState = {enabled: false, totalFaces: 0, heroFacesTotal: 0, faceBudget: config.faceBudget, withinBudget: true, objects: []};
        return lastState;
      }

      const budgetResult = allocateSceneBeautyLods(candidates, {
        camera,
        viewportHeight,
        maxPixelError: config.maxPixelError,
        faceBudget: config.faceBudget,
        stat: config.stat,
        texelWeight: config.texelWeight,
        tailWeight: config.tailWeight,
        creviceAllowance: config.creviceAllowance,
        hysteresis: config.hysteresis,
      });

      const objectStates = [];
      for (const c of candidates) {
        const alloc = budgetResult.allocations[c.id];
        const targetTier = alloc.tier;
        c.entry.footprintTier = alloc.footprintTier ?? targetTier;
        c.entry.activeTier = targetTier;

        if (targetTier === 'hero') {
          c.entry.displayedTier = 'hero';
        } else if (c.entry.rungs.has(targetTier)) {
          c.entry.displayedTier = targetTier;
        } else {
          const levelObj = c.handle.levels.find(l => (l.sha ?? l.sha256) === targetTier);
          if (levelObj) ensureRungLoaded(c.root, c.entry, levelObj);
          // Non-blocking fallback: keep current displayedTier if still valid/resident, else 'hero'
          if (c.entry.displayedTier !== 'hero' && !c.entry.rungs.has(c.entry.displayedTier)) {
            c.entry.displayedTier = 'hero';
          }
        }
        applyDisplayedRung(c.root, c.entry);
        const displayedFaces = c.entry.displayedTier === 'hero'
          ? c.entry.heroFaces
          : (c.entry.rungs.get(c.entry.displayedTier)?.faces ?? c.entry.heroFaces);
        objectStates.push({
          id: c.id,
          targetTier,
          displayedTier: c.entry.displayedTier,
          faces: displayedFaces,
          targetFaces: alloc.faces,
          totalFaces: alloc.inFrustum ? alloc.instanceCount * displayedFaces : 0,
          instanceCount: alloc.instanceCount,
          pixelError: alloc.pixelError,
          inFrustum: alloc.inFrustum,
          pinned: alloc.pinned,
          demotedByBudget: alloc.demotedByBudget,
          residentRungs: c.entry.rungs.size,
        });
      }

      lastState = {
        enabled: true,
        totalFaces: budgetResult.totalFaces,
        heroFacesTotal: budgetResult.heroFacesTotal,
        faceBudget: config.faceBudget,
        maxPixelError: config.maxPixelError,
        withinBudget: budgetResult.withinBudget,
        objects: objectStates,
      };
      return lastState;
    },
    withFrame(camera, options, fn) {
      const callback = typeof options === 'function' ? options : fn;
      const opts = typeof options === 'function' ? {} : options;
      this.update(camera, opts);
      try {
        return callback?.(lastState);
      } finally {
        this.restoreAllHeroes();
      }
    },
    borrowFrame(camera, options = {}) {
      this.update(camera, options);
      let restored = false;
      return () => {
        if (restored) return;
        restored = true;
        this.restoreAllHeroes();
      };
    },
    async prepareFrame(camera, options = {}) {
      if (disposed || !camera) return lastState;
      await giProxies?.whenIdle?.();
      this.update(camera, options);
      this.restoreAllHeroes();
      await this.whenIdle();
      const state = this.update(camera, options);
      this.restoreAllHeroes();
      return state;
    },
    restoreAllHeroes() {
      for (const [root, entry] of entries) {
        restoreRootToHero(root, entry);
      }
    },
    withHeroes(fn) {
      const restores = [];
      for (const [root, entry] of entries) {
        if (entry.displayedTier !== 'hero') {
          restoreRootToHero(root, entry);
          restores.push(() => applyDisplayedRung(root, entry));
        }
      }
      try {
        return fn();
      } finally {
        for (let i = restores.length - 1; i >= 0; i--) restores[i]();
      }
    },
    state: () => lastState,
    getResidentRung(root, sha) {
      return entries.get(root)?.rungs.get(sha) ?? null;
    },
    listResidentRungs(root) {
      const entry = entries.get(root);
      return entry ? [...entry.rungs.values()] : [];
    },
    applyWarp: (root, warpFn, options) => applyRootVertexWarpToRung(THREE, root, warpFn, options),
    whenIdle: async () => {
      while (pendingLoads.size) await Promise.all([...pendingLoads]);
    },
    restoreHero(root) {
      const entry = entries.get(root);
      if (!entry) return;
      entry.activeTier = 'hero';
      entry.footprintTier = 'hero';
      entry.displayedTier = 'hero';
      restoreRootToHero(root, entry);
    },
    release,
    clear() {
      for (const root of [...entries.keys()]) release(root);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unbindGiRelease?.();
      for (const root of [...entries.keys()]) release(root);
    },
  };
}
