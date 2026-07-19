import assert from 'node:assert/strict';

const PAGE_PATH = '/structural-combustion.html';
const PAGE_ROUTE = 'kaminos.structural-combustion-dimensional-witness.v0';
const AUTHORITY = 'same-device-pyro-node-material-bond-strength-v0';
const CARRIED_FIRE_MODE = 'carried-fire';
const MESH_PRESENTATION_MODE = 'indexed-mesh-skin-resident-structural-proxy-v0';
const MESH_ASSET_PATH = '/assets/structural-combustion/irregular-timber-two-island.glb';
const REQUIRED_ROLES = ['emitter', 'control', 'propagation-target', 'propagation-control'];
const REQUIRED_CARRIED_CHECKS = [
  'detachedEmitterMoved',
  'movedSourceAccepted',
  'propagationTargetExposed',
  'propagationAfterDetachment',
  'propagationWithinMovedSourceWindow',
  'propagationTargetIgnited',
  'propagationControlCool',
];

function assertScreenshot(record, name) {
  assert.ok(record?.sha256, `${name} screenshot identity is missing`);
  assert.ok(record.sampledPixels > 0, `${name} screenshot has no sampled pixels`);
  assert.ok(
    record.nonDarkPixels >= Math.max(64, Math.floor(record.sampledPixels * 0.005)),
    `${name} screenshot is blank or substantially occluded`,
  );
}

export function validateStructuralCombustionEvidence(evidence) {
  assert.ok(evidence && typeof evidence === 'object', 'structural combustion evidence is missing');
  const requested = new URL(evidence.requestedUrl);
  const effective = new URL(evidence.effectiveUrl);
  assert.equal(requested.pathname, PAGE_PATH, 'requested route is not the structural combustion witness');
  assert.equal(effective.pathname, PAGE_PATH, 'effective route does not match the requested structural combustion witness');
  assert.equal(evidence.requestedBackend, 'webgpu', 'requested backend identity is not WebGPU');
  assert.match(evidence.effectiveBackend || '', /^WebGPU:/, 'effective backend is not WebGPU');
  assert.equal(evidence.pageRoute, PAGE_ROUTE, 'effective page route identity is not the structural combustion witness');
  assert.equal(evidence.authority, AUTHORITY, 'effective causal authority identity is not structural combustion');
  assert.equal(evidence.presentationMode, MESH_PRESENTATION_MODE, 'effective presentation is not the mesh presentation mode');
  assert.deepEqual(evidence.runtimeErrors, [], 'runtime errors invalidate the browser witness');

  const meshAsset = evidence.meshAssetReceipt;
  assert.ok(meshAsset && typeof meshAsset === 'object', 'mesh asset receipt is missing');
  assert.equal(meshAsset.status, 'loaded', 'mesh asset receipt is not loaded');
  const requestedAsset = new URL(meshAsset.requestedUrl, evidence.requestedUrl);
  const effectiveAsset = new URL(meshAsset.effectiveUrl);
  assert.equal(requestedAsset.pathname, MESH_ASSET_PATH, 'requested mesh asset route is wrong');
  assert.equal(effectiveAsset.pathname, MESH_ASSET_PATH, 'effective mesh asset route is wrong');
  assert.equal(requestedAsset.pathname, effectiveAsset.pathname, 'effective mesh asset route differs from the request');
  assert.match(meshAsset.assetIdentity || '', /^sha256:[0-9a-f]{64}$/, 'mesh asset identity is not a SHA-256 receipt');
  assert.ok(meshAsset.byteLength > 0, 'mesh asset receipt has no bytes');
  assert.ok(meshAsset.vertexCount >= 6, 'mesh asset receipt has too few vertices');
  assert.ok(meshAsset.triangleCount >= 2, 'mesh asset receipt has too few triangles');
  const islandIds = new Set(meshAsset.islandIds || []);
  assert.ok(islandIds.has('root') && islandIds.has('free') && islandIds.size >= 2, 'mesh asset receipt lacks the authored islands');

  for (const phase of ['initial', 'orbited', 'final']) {
    assertScreenshot(evidence[phase]?.screenshot, phase);
  }
  assert.notEqual(evidence.initial.screenshot.sha256, evidence.orbited.screenshot.sha256, 'orbited screenshot is stale');
  assert.notEqual(evidence.initial.screenshot.sha256, evidence.final.screenshot.sha256, 'final screenshot is stale');
  assert.notEqual(evidence.orbited.screenshot.sha256, evidence.final.screenshot.sha256, 'final screenshot repeats the orbited frame');
  assert.ok(evidence.final.frame > evidence.initial.frame, 'simulation frame did not advance');

  const initialCamera = evidence.initial.camera;
  const orbitedCamera = evidence.orbited.camera;
  assert.ok(initialCamera && orbitedCamera, 'camera evidence is missing');
  assert.ok(orbitedCamera.interactionCount > initialCamera.interactionCount, 'camera interaction did not reach the application');
  assert.ok(
    orbitedCamera.yaw !== initialCamera.yaw ||
      orbitedCamera.pitch !== initialCamera.pitch ||
      orbitedCamera.distance !== initialCamera.distance,
    'camera orbit and zoom left the view unchanged',
  );

  const terminal = evidence.final.terminalReceipt;
  assert.equal(terminal?.status, 'passed', 'terminal receipt did not pass');
  assert.equal(terminal.mode, CARRIED_FIRE_MODE, 'terminal receipt is not in carried-fire mode');
  assert.ok(Array.isArray(terminal.structures), 'terminal receipt structures are missing');
  for (const role of REQUIRED_ROLES) {
    assert.equal(
      terminal.structures.filter(structure => structure?.role === role).length,
      1,
      `terminal receipt requires exactly one ${role}`,
    );
  }
  assert.equal(terminal.structures.length, REQUIRED_ROLES.length, 'terminal receipt contains unexpected structural roles');
  for (const structure of terminal.structures) {
    assert.equal(
      structure.meshAssetIdentity,
      meshAsset.assetIdentity,
      `mesh asset identity continuity failed for ${structure.role || 'unknown role'}`,
    );
    assert.equal(
      structure.meshTriangleCount,
      meshAsset.triangleCount,
      `mesh triangle continuity failed for ${structure.role || 'unknown role'}`,
    );
  }
  assert.ok(terminal.carriedAudit?.movedSourceRecords > 0, 'terminal carried-source audit is missing or empty');
  for (const check of REQUIRED_CARRIED_CHECKS) {
    assert.ok(Object.hasOwn(terminal.checks || {}, check), `terminal receipt is missing ${check}`);
    assert.equal(terminal.checks[check], true, `terminal receipt failed ${check}`);
  }
  assert.ok(
    terminal.checks && Object.values(terminal.checks).length > 0 && Object.values(terminal.checks).every(Boolean),
    'terminal receipt contains a failed causal check',
  );
  assert.ok(terminal.dispatchCount > 0, 'terminal receipt has no GPU material dispatches');
  assert.ok(terminal.presentationCount > 0, 'terminal receipt has no GPU presentation passes');
  assert.equal(terminal.liveRuntimeReadbackCount, 0, 'live readback entered the causal runtime');
  assert.equal(terminal.terminalReadbackCount, 1, 'terminal receipt did not use exactly one frozen readback');
  assert.equal(terminal.terminalMapAsyncCount, 1, 'terminal receipt did not use exactly one frozen map');
  assert.equal(terminal.hostCausalFeedbackCount, 0, 'host feedback entered the causal runtime');

  return {
    status: 'passed',
    requestedRoute: requested.pathname,
    effectiveRoute: effective.pathname,
    effectiveBackend: evidence.effectiveBackend,
    meshAssetIdentity: meshAsset.assetIdentity,
    terminalChecks: { ...terminal.checks },
  };
}
