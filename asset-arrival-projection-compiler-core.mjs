import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

export const ASSET_ARRIVAL_SOURCE_SCHEMA = 'kaminos.asset-arrival-source.v0';
export const ASSET_ARRIVAL_PROJECTION_PLAN_SCHEMA = 'kaminos.asset-arrival-projection-plan.v0';
export const ASSET_ARRIVAL_PROJECTION_REPORT_SCHEMA = 'kaminos.asset-arrival-projection-report.v0';
export const ASSET_ARRIVAL_FAILURE_SCHEMA = 'kaminos.asset-arrival-projection-failure.v0';

const COMPILER_ID = 'kaminos.asset-arrival-projection-compiler.v0';
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VARIANTS = Object.freeze(['parent', 'positive', 'negative']);
const RUNGS = Object.freeze(['L', 'H']);
const BASE_PRODUCTS = Object.freeze(['clay', 'depth', 'normal']);
const ROLE_MASK = 'semantic-role-mask';
const RELATIONAL_TRACK_ID = 'generator-relational-sensitivity';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function hashJson(value) {
  return sha256(Buffer.from(JSON.stringify(canonical(value))));
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireHash(value, label) {
  if (!HASH_PATTERN.test(value ?? '')) throw new Error(`${label} must be a SHA-256 identity`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
}

function requireFrame(frame, label) {
  if (!Array.isArray(frame) || frame.length !== 16 || frame.some(value => !finite(value))) {
    throw new Error(`${label} must be a finite 4x4 local frame`);
  }
}

function assertSourceReceipt(source) {
  if (source?.schema !== ASSET_ARRIVAL_SOURCE_SCHEMA) {
    throw new Error('asset-arrival source schema mismatch');
  }
  if (source.trackId !== RELATIONAL_TRACK_ID) {
    throw new Error(`L/H projection compiler serves only ${RELATIONAL_TRACK_ID}`);
  }
  requireString(source.receiptId, 'source receipt id');
  requireString(source.asset?.id, 'asset id');
  requireString(source.asset?.blendPath, 'authored blend path');
  requireHash(source.asset?.blendSha256, 'authored blend hash');

  if (!Array.isArray(source.parts)) throw new Error('semantic parts are required');
  const roleIds = source.parts.map(part => part?.roleId);
  if (new Set(roleIds).size !== roleIds.length) throw new Error('semantic part roles must be unique');
  const requiredRoleIds = source.contract?.requiredPartRoleIds;
  if (!Array.isArray(requiredRoleIds) || requiredRoleIds.length === 0
    || new Set(requiredRoleIds).size !== requiredRoleIds.length) {
    throw new Error('contract-required semantic part role list is missing or duplicated');
  }
  for (const required of requiredRoleIds) {
    if (!roleIds.includes(required)) throw new Error(`missing contract-required semantic part ${required}`);
  }
  for (const part of source.parts) {
    requireString(part.roleId, 'semantic part role id');
    requireString(part.objectName, `${part.roleId} Blender object name`);
    requireFrame(part.localFrame, `${part.roleId} local frame`);
    requireHash(part.geometrySha256, `${part.roleId} geometry hash`);
  }

  requireString(source.camera?.id, 'camera id');
  requireString(source.camera?.objectName, 'camera Blender object name');
  requireFrame(source.camera?.localFrame, 'camera local frame');
  requireHash(source.camera?.cameraSha256, 'camera hash');
  if (source.camera?.projection !== 'orthographic' && source.camera?.projection !== 'perspective') {
    throw new Error('camera projection must be orthographic or perspective');
  }
  if (!Number.isInteger(source.camera?.width) || source.camera.width <= 0
    || !Number.isInteger(source.camera?.height) || source.camera.height <= 0) {
    throw new Error('camera dimensions must be positive integers');
  }

  const relation = source.relation;
  for (const [value, label] of [
    [relation?.id, 'relation id'],
    [relation?.regionId, 'relation region id'],
    [relation?.scalarId, 'relation scalar id'],
    [relation?.axisPartRoleId, 'relation axis role id'],
  ]) requireString(value, label);
  if (!roleIds.includes(relation.axisPartRoleId)) throw new Error('relation axis role is not a named part');
  if (!Array.isArray(relation.participantRoleIds) || relation.participantRoleIds.length < 2
    || new Set(relation.participantRoleIds).size !== relation.participantRoleIds.length
    || relation.participantRoleIds.some(roleId => !roleIds.includes(roleId))) {
    throw new Error('relation participant roles must name at least two distinct semantic parts');
  }
  for (const field of ['parentValue', 'delta', 'lowerBound', 'upperBound', 'maxDelta']) {
    if (!finite(relation[field])) throw new Error(`relation ${field} must be finite`);
  }
  const roomAbove = relation.upperBound - relation.parentValue;
  const roomBelow = relation.parentValue - relation.lowerBound;
  const admittedDelta = Math.min(relation.maxDelta, 0.5 * Math.min(roomAbove, roomBelow));
  if (!(relation.delta > 0) || relation.delta !== admittedDelta) {
    throw new Error('relation delta does not match the bounded symmetric assay rule');
  }

  const expected = {
    parent: relation.parentValue,
    positive: relation.parentValue + relation.delta,
    negative: relation.parentValue - relation.delta,
  };
  for (const variant of VARIANTS) {
    const item = source.variants?.[variant];
    if (!item) throw new Error(`missing ${variant} source variant`);
    if (item.relationValue !== expected[variant]) {
      throw new Error(`${variant} relation value does not match the authored signed relation`);
    }
    requireString(item.sourceSceneId, `${variant} source scene id`);
    requireHash(item.sourceInputHash, `${variant} source input hash`);
    if (!finite(item.sourceSpillover) || item.sourceSpillover < 0) {
      throw new Error(`${variant} source spillover must be non-negative`);
    }
    const checks = Object.values(item.sourceChecks ?? {});
    if (checks.length === 0 || checks.some(value => value !== true)) {
      throw new Error(`${variant} source predecessor checks did not all pass`);
    }
  }

  if (!Array.isArray(source.roleRegistry) || source.roleRegistry.length !== source.parts.length) {
    throw new Error('role registry must cover every semantic part exactly once');
  }
  const registryRoles = source.roleRegistry.map(role => role?.roleId);
  if (new Set(registryRoles).size !== source.parts.length
    || roleIds.some(roleId => !registryRoles.includes(roleId))) {
    throw new Error('role registry does not exactly match semantic part roles');
  }
  const maskValues = source.roleRegistry.map(role => role?.maskValue);
  if (maskValues.some(value => !Number.isInteger(value) || value <= 0)
    || new Set(maskValues).size !== maskValues.length) {
    throw new Error('role mask values must be unique positive integers');
  }

  requireString(source.route?.requestedRouteId, 'requested projection route id');
  if (source.route?.supportsCpu !== true || source.route?.supportsRoleMask !== true) {
    throw new Error('requested projection route must support CPU rendering and role masks');
  }
}

export function buildAssetArrivalProjectionPlan(source) {
  assertSourceReceipt(source);
  const frozenIdentities = {
    assetSha256: source.asset.blendSha256,
    cameraSha256: source.camera.cameraSha256,
    partSetSha256: hashJson(source.parts),
    roleRegistrySha256: hashJson(source.roleRegistry),
  };
  const cells = RUNGS.flatMap(rungId => VARIANTS.map(variant => ({
    id: `${rungId}_${variant}`,
    rungId,
    variant,
    editSign: variant === 'parent' ? 0 : (variant === 'positive' ? 1 : -1),
    relationRegionId: source.relation.regionId,
    relationValue: source.variants[variant].relationValue,
    sourceInputHash: source.variants[variant].sourceInputHash,
    channelIds: rungId === 'L' ? [...BASE_PRODUCTS] : [...BASE_PRODUCTS, ROLE_MASK],
  })));
  return {
    schema: ASSET_ARRIVAL_PROJECTION_PLAN_SCHEMA,
    compilerId: COMPILER_ID,
    trackId: RELATIONAL_TRACK_ID,
    scope: {
      genericSourceFields: [
        'receiptId',
        'asset.id',
        'asset.blendPath',
        'asset.blendSha256',
        'parts',
        'camera',
        'roleRegistry',
        'route.requestedRouteId',
      ],
      relationalTrackFields: [
        'trackId',
        'contract.requiredPartRoleIds',
        'relation',
        'relation.participantRoleIds',
        'variants.parent',
        'variants.positive',
        'variants.negative',
      ],
      excludedAuthority: 'shape-bearing-musculature',
      bridgeDecisionOwner: 'composition-owner',
    },
    sourceReceiptId: source.receiptId,
    asset: structuredClone(source.asset),
    camera: structuredClone(source.camera),
    relation: structuredClone(source.relation),
    roleRegistry: structuredClone(source.roleRegistry),
    frozenIdentities,
    requestedRouteId: source.route.requestedRouteId,
    productKinds: [...BASE_PRODUCTS, ROLE_MASK],
    cells,
  };
}

function validateRenderedVariant(result, request) {
  if (result?.effectiveRouteId !== request.requestedRouteId) {
    const error = new Error(
      `effective route mismatch: requested ${request.requestedRouteId}, got ${result?.effectiveRouteId ?? 'missing'}`,
    );
    error.failurePhase = 'render-dispatch';
    throw error;
  }
  for (const [actual, expected, label] of [
    [result.sourceInputHash, request.sourceInputHash, 'source input hash'],
    [result.cameraHash, request.camera.cameraSha256, 'camera hash'],
    [result.productConfigHash, request.productConfigHash, 'product config hash'],
  ]) {
    if (actual !== expected) throw new Error(`${label} mismatch in renderer receipt`);
  }
  if (!Array.isArray(result.products)) throw new Error('renderer product set is incomplete');
  const kinds = result.products.map(product => product?.kind);
  if (result.products.length !== request.productKinds.length
    || new Set(kinds).size !== request.productKinds.length
    || request.productKinds.some(kind => !kinds.includes(kind))) {
    throw new Error('renderer product set is incomplete or duplicated');
  }
  for (const product of result.products) {
    if (product.mimeType !== 'image/png') throw new Error(`${product.kind} product is not image/png`);
    if (product.width !== request.camera.width || product.height !== request.camera.height) {
      throw new Error(`${product.kind} product dimensions do not match requested camera`);
    }
    if (!(product.bytes instanceof Uint8Array) || product.bytes.byteLength === 0) {
      throw new Error(`${product.kind} product is blank`);
    }
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function publishDirectory(stagingDir, outDir) {
  const backup = `${outDir}.backup-${process.pid}-${Date.now()}`;
  const hadPrior = await pathExists(outDir);
  if (hadPrior) await rename(outDir, backup);
  try {
    await rename(stagingDir, outDir);
  } catch (error) {
    if (hadPrior && await pathExists(backup)) await rename(backup, outDir);
    throw error;
  }
  if (hadPrior) await rm(backup, { recursive: true, force: true });
}

function failureReceipt({ source, outDir, phase, error, lastTrustworthyEvidence }) {
  return {
    schema: ASSET_ARRIVAL_FAILURE_SCHEMA,
    compilerId: COMPILER_ID,
    status: 'failed',
    trackId: source?.trackId ?? null,
    sourceReceiptId: source?.receiptId ?? null,
    assetId: source?.asset?.id ?? null,
    requestedRouteId: source?.route?.requestedRouteId ?? null,
    outputIdentity: basename(outDir),
    failure: {
      phase: error?.failurePhase ?? phase,
      name: error?.name ?? 'Error',
      message: error?.message ?? String(error),
    },
    lastTrustworthyEvidence,
  };
}

export function validateAssetArrivalProjectionReport(report) {
  const failures = [];
  const fail = message => failures.push(message);
  if (report?.schema !== ASSET_ARRIVAL_PROJECTION_REPORT_SCHEMA) fail('schema mismatch');
  if (report?.status !== 'published') fail('status is not published');
  if (report?.trackId !== RELATIONAL_TRACK_ID) fail('track identity mismatch');
  if (!HASH_PATTERN.test(report?.source?.assetSha256 ?? '')) fail('asset hash missing');
  if (!HASH_PATTERN.test(report?.source?.cameraSha256 ?? '')) fail('camera hash missing');
  if (report?.route?.requestedRouteId !== report?.route?.effectiveRouteId) fail('route identity mismatch');
  if (report?.route?.fallbackUsed !== false) fail('fallback route was used');
  if (report?.projectionInvocations !== 3) fail('projection invocation count is not three');
  const expectedIds = RUNGS.flatMap(rung => VARIANTS.map(variant => `${rung}_${variant}`));
  const cells = Array.isArray(report?.cells) ? report.cells : [];
  if (cells.length !== 6 || new Set(cells.map(cell => cell?.id)).size !== 6
    || expectedIds.some(id => !cells.some(cell => cell?.id === id))) {
    fail('six-cell matrix is incomplete or duplicated');
  }
  for (const variant of VARIANTS) {
    const low = cells.find(cell => cell?.id === `L_${variant}`);
    const high = cells.find(cell => cell?.id === `H_${variant}`);
    const lowKinds = low?.products?.map(product => product.kind) ?? [];
    const highKinds = high?.products?.map(product => product.kind) ?? [];
    if (JSON.stringify(lowKinds) !== JSON.stringify(BASE_PRODUCTS)) fail(`${variant} L product set drifted`);
    if (JSON.stringify(highKinds) !== JSON.stringify([...BASE_PRODUCTS, ROLE_MASK])) {
      fail(`${variant} H enrichment is not singular`);
    }
    for (const kind of BASE_PRODUCTS) {
      const lowProduct = low?.products?.find(product => product.kind === kind);
      const highProduct = high?.products?.find(product => product.kind === kind);
      if (!HASH_PATTERN.test(lowProduct?.sha256 ?? '') || lowProduct?.sha256 !== highProduct?.sha256) {
        fail(`${variant} ${kind} differs between L and H`);
      }
    }
    const mask = high?.products?.find(product => product.kind === ROLE_MASK);
    if (!HASH_PATTERN.test(mask?.sha256 ?? '')) fail(`${variant} H role mask lacks hash evidence`);
  }
  return { ok: failures.length === 0, failures };
}

export async function compileAssetArrivalProjections({ source, outDir, renderVariant }) {
  if (typeof outDir !== 'string' || outDir.length === 0) throw new Error('output directory is required');
  if (typeof renderVariant !== 'function') throw new Error('renderVariant adapter is required');
  let phase = 'source-validation';
  let stagingDir = null;
  let lastTrustworthyEvidence = 'no source receipt admitted';
  const failurePath = `${outDir}.failure.json`;
  try {
    const plan = buildAssetArrivalProjectionPlan(source);
    lastTrustworthyEvidence = 'source receipt, named parts, signed relation, and fixed camera admitted';
    phase = 'manifest-construction';
    const productConfigHash = hashJson({
      compilerId: COMPILER_ID,
      camera: plan.camera,
      productKinds: plan.productKinds,
      roleRegistry: plan.roleRegistry,
    });
    stagingDir = `${outDir}.staging-${process.pid}-${Date.now()}`;
    await mkdir(stagingDir, { recursive: false });
    const projections = new Map();
    const routeReceipts = [];

    for (const variant of VARIANTS) {
      const sourceVariant = source.variants[variant];
      phase = 'render-dispatch';
      const request = {
        compilerId: COMPILER_ID,
        trackId: RELATIONAL_TRACK_ID,
        sourceReceiptId: source.receiptId,
        asset: structuredClone(source.asset),
        parts: structuredClone(source.parts),
        roleRegistry: structuredClone(source.roleRegistry),
        relation: structuredClone(source.relation),
        variant,
        sourceSceneId: sourceVariant.sourceSceneId,
        sourceInputHash: sourceVariant.sourceInputHash,
        camera: structuredClone(source.camera),
        requestedRouteId: source.route.requestedRouteId,
        productKinds: [...plan.productKinds],
        productConfigHash,
      };
      const result = await renderVariant(request);
      if (result?.effectiveRouteId !== request.requestedRouteId) {
        const error = new Error(
          `effective route mismatch: requested ${request.requestedRouteId}, got ${result?.effectiveRouteId ?? 'missing'}`,
        );
        error.failurePhase = 'render-dispatch';
        throw error;
      }
      phase = 'product-validation';
      validateRenderedVariant(result, request);
      const productEvidence = new Map();
      for (const product of result.products) {
        const bytes = Buffer.from(product.bytes);
        productEvidence.set(product.kind, {
          kind: product.kind,
          mimeType: product.mimeType,
          width: product.width,
          height: product.height,
          byteSize: bytes.length,
          sha256: sha256(bytes),
          bytes,
        });
      }
      projections.set(variant, productEvidence);
      routeReceipts.push({
        variant,
        requestedRouteId: request.requestedRouteId,
        effectiveRouteId: result.effectiveRouteId,
        sourceInputHash: result.sourceInputHash,
        cameraHash: result.cameraHash,
        productConfigHash: result.productConfigHash,
      });
      lastTrustworthyEvidence = `${variant} projection validated with exact route, source, camera, dimensions, and products`;
    }

    phase = 'publication';
    const cells = [];
    for (const cell of plan.cells) {
      const cellDir = join(stagingDir, 'cells', cell.id);
      await mkdir(cellDir, { recursive: true });
      const products = [];
      for (const kind of cell.channelIds) {
        const evidence = projections.get(cell.variant).get(kind);
        const fileName = `${kind}.png`;
        const path = join(cellDir, fileName);
        await writeFile(path, evidence.bytes);
        products.push({
          kind,
          path: relative(stagingDir, path),
          mimeType: evidence.mimeType,
          width: evidence.width,
          height: evidence.height,
          byteSize: evidence.byteSize,
          sha256: evidence.sha256,
        });
      }
      cells.push({
        ...cell,
        products,
      });
    }

    const report = {
      schema: ASSET_ARRIVAL_PROJECTION_REPORT_SCHEMA,
      compilerId: COMPILER_ID,
      status: 'published',
      trackId: RELATIONAL_TRACK_ID,
      sourceReceiptId: source.receiptId,
      assetId: source.asset.id,
      source: {
        assetSha256: plan.frozenIdentities.assetSha256,
        cameraSha256: plan.frozenIdentities.cameraSha256,
        partSetSha256: plan.frozenIdentities.partSetSha256,
        roleRegistrySha256: plan.frozenIdentities.roleRegistrySha256,
      },
      relation: structuredClone(plan.relation),
      camera: structuredClone(plan.camera),
      route: {
        requestedRouteId: plan.requestedRouteId,
        effectiveRouteId: plan.requestedRouteId,
        fallbackUsed: false,
        productConfigHash,
        variantReceipts: routeReceipts,
      },
      projectionInvocations: VARIANTS.length,
      cells,
    };
    const validation = validateAssetArrivalProjectionReport(report);
    if (!validation.ok) throw new Error(`compiled report failed validation: ${validation.failures.join('; ')}`);
    await atomicWriteJson(join(stagingDir, 'projection-report.json'), report);
    await publishDirectory(stagingDir, outDir);
    stagingDir = null;
    await rm(failurePath, { force: true });
    return report;
  } catch (error) {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
    await atomicWriteJson(failurePath, failureReceipt({
      source,
      outDir,
      phase,
      error,
      lastTrustworthyEvidence,
    }));
    throw error;
  }
}

export async function readAssetArrivalProjectionReport(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
