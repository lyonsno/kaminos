import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  createAuthoredPackingAuthorityProfile,
  measureAuthoredPackingSweepContacts,
  validateAuthoredPackingSweepManifest,
} from '../authored-packing-sweep-core.mjs';
import * as authoredPacking from '../authored-packing-sweep-core.mjs';
import {
  hashMuscleCompartmentRingCageCanonicalJson,
} from '../muscle-compartment-ring-cage-core.mjs';
import {
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
} from '../muscle-compartment-ring-cage-contact-core.mjs';
import {
  hashMusclePackingCanonicalJson,
} from '../muscle-compartment-packing-core.mjs';
import {
  renderMuscleCompartmentRingCageContactHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';
import * as contactWitness from '../muscle-compartment-ring-cage-contact-witness.mjs';
import {
  validateMuscleCompartmentRingCageContactVisualReceipts,
} from '../muscle-compartment-ring-cage-contact-visual-receipts.mjs';

const FIXTURE_URL = new URL(
  '../fixtures/authored-packing/packing-fixture-v001.json',
  import.meta.url,
);

async function fixture() {
  return JSON.parse(await readFile(FIXTURE_URL, 'utf8'));
}

function variant(manifest, role) {
  return Object.values(manifest.variants).find(row => row.role === role);
}

async function withStaticFixtureServer(root, action) {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1/');
    const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
    try {
      const bytes = await readFile(path.join(root, relative));
      response.writeHead(200, { 'content-type':'application/octet-stream' });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await action(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runChild(command, args, options) {
  const child = spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', chunk => { stdout += chunk; });
  child.stderr?.on('data', chunk => { stderr += chunk; });
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { status, stdout, stderr };
}

test('authored sweep manifest preserves the effective operator source and fails loud on geometry or route drift', async () => {
  const manifest = await fixture();
  assert.doesNotThrow(() => validateAuthoredPackingSweepManifest(manifest));
  assert.deepEqual(manifest.source.input.effective, manifest.source.input.requested);
  assert.equal(manifest.memberOrder.length, 6);

  const geometryForgery = structuredClone(manifest);
  geometryForgery.variants.clean.members[0].mesh.vertices[0][0] += 0.01;
  assert.throws(
    () => validateAuthoredPackingSweepManifest(geometryForgery),
    /identity does not match effective geometry/,
  );

  const routeForgery = structuredClone(manifest);
  routeForgery.source.input.effective.sha256 = '0'.repeat(64);
  assert.throws(
    () => validateAuthoredPackingSweepManifest(routeForgery),
    /requested\/effective source identities disagree/,
  );
});

test('topology-preserving sweep contact agrees with Blender mesh truth across clean, mild, and severe authored states', async () => {
  const manifest = await fixture();
  const expected = new Map([
    ['clean-reference', { pairwiseIntersectionCount:0, skeletalIntersectionCount:0 }],
    ['mild-interpenetration', { pairwiseIntersectionCount:3, skeletalIntersectionCount:5 }],
    ['severe-interpenetration', { pairwiseIntersectionCount:8, skeletalIntersectionCount:4 }],
  ]);

  for (const [role, counts] of expected) {
    const source = variant(manifest, role);
    const measurement = measureAuthoredPackingSweepContacts({
      manifest,
      variantId:source.id,
    });
    assert.equal(measurement.summary.meshTruthAgreement, true, `${role} contact identities`);
    assert.equal(measurement.summary.pairwiseIntersectionCount, counts.pairwiseIntersectionCount);
    assert.equal(measurement.summary.skeletalIntersectionCount, counts.skeletalIntersectionCount);
    assert.deepEqual(measurement.summary.predictedKeys, measurement.summary.meshTruthKeys);
  }
});

test('restoration and sculpt-continuation share the observed pathology but cannot impersonate one another\'s intent', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const restoration = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const continuation = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:mild.id,
    policy:'sculpt-continuation',
  });

  assert.deepEqual(restoration.observedState, continuation.observedState);
  assert.deepEqual(
    restoration.members.map(row => row.observed),
    continuation.members.map(row => row.observed),
  );
  assert.equal(restoration.intentState.variantId, clean.id);
  assert.equal(continuation.intentState.variantId, mild.id);
  assert.deepEqual(
    restoration.members.map(row => row.intent.targetVolume),
    clean.members.map(row => row.meshVolume),
  );
  assert.deepEqual(
    continuation.members.map(row => row.intent.targetVolume),
    mild.members.map(row => row.meshVolume),
  );
  assert.notDeepEqual(
    restoration.members.map(row => row.intent.targetVolume),
    continuation.members.map(row => row.intent.targetVolume),
  );
  assert.notDeepEqual(
    restoration.members.map(row => row.intent.insertion),
    continuation.members.map(row => row.intent.insertion),
  );
  assert.equal(restoration.packingLaw.contact, 'topology-preserving-swept-body-exclusion');
  assert.equal(continuation.packingLaw.centerlinePreference, 'minimum-displacement-from-observed-state');

  assert.throws(
    () => createAuthoredPackingAuthorityProfile({
      manifest,
      observedVariantId:mild.id,
      intentVariantId:clean.id,
      policy:'sculpt-continuation',
    }),
    /current authored state to own both observation and intent/,
  );
});

test('authored intent projects exact observed rings into the existing positive-volume N-body carrier', async () => {
  assert.equal(
    typeof authoredPacking.createAuthoredPackingRingCageBridge,
    'function',
    'authored packing must expose a solver bridge rather than reconstructing circular proxies',
  );
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const authorityProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const bridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile,
  });

  assert.equal(bridge.source.authority.kind, 'operator-authored');
  assert.equal(bridge.source.input.effective.kind, 'operator-authored-fixture');
  assert.deepEqual(bridge.observedCarrier.orderedConstructionIds, manifest.memberOrder);
  assert.deepEqual(bridge.solverCarrier.orderedConstructionIds, manifest.memberOrder);
  assert.notEqual(
    bridge.observedCarrier.identity.sha256,
    bridge.solverCarrier.identity.sha256,
    'the exact authored observation must not impersonate endpoint-normalized solver initialization',
  );
  assert.deepEqual(bridge.initialization, {
    schema:'kaminos.authored-packing-solver-initialization.v0',
    observedCarrierSha256:bridge.observedCarrier.identity.sha256,
    initializedCarrierSha256:bridge.solverCarrier.identity.sha256,
    endpointPolicy:'intent-endpoints-observed-interior',
    endpointDisplacements:bridge.initialization.endpointDisplacements,
    identity:bridge.initialization.identity,
  });
  const initializationCore = structuredClone(bridge.initialization);
  delete initializationCore.identity;
  assert.equal(
    bridge.initialization.identity.sha256,
    authoredPacking.hashAuthoredPackingCanonicalJson(initializationCore),
  );
  assert.ok(bridge.initialization.endpointDisplacements.some(row => row.maximumDisplacement > 0.1));
  for (const [memberIndex, memberId] of manifest.memberOrder.entries()) {
    const observedNodes = new Map(bridge.observedCarrier.cages[memberIndex].manifest.nodes.map(
      node => [node.id, node],
    ));
    const initializedNodes = new Map(bridge.solverCarrier.cages[memberIndex].manifest.nodes.map(
      node => [node.id, node],
    ));
    const lastSection = mild.members[memberIndex].rings.length - 1;
    for (const sectionIndex of [0, lastSection]) {
      const axisId = `${memberId}:section:${String(sectionIndex).padStart(4, '0')}:axis`;
      assert.deepEqual(
        observedNodes.get(axisId).currentPosition,
        mild.members[memberIndex].centerline[sectionIndex].position,
        `${memberId} exact observed endpoint ${sectionIndex}`,
      );
      assert.deepEqual(
        initializedNodes.get(axisId).currentPosition,
        clean.members[memberIndex].centerline[sectionIndex].position,
        `${memberId} initialized endpoint ${sectionIndex}`,
      );
    }
    const interiorSection = Math.floor(lastSection / 2);
    const interiorAxisId = `${memberId}:section:${String(interiorSection).padStart(4, '0')}:axis`;
    assert.deepEqual(
      initializedNodes.get(interiorAxisId).currentPosition,
      mild.members[memberIndex].centerline[interiorSection].position,
      `${memberId} initialized interior remains authored observation`,
    );
  }
  assert.equal(bridge.solverCarrier.cages.length, manifest.memberOrder.length);
  assert.ok(bridge.solverCarrier.cages.every(cage =>
    cage.manifest.nodes.some(node => node.restPosition.some(
      (value, axis) => value !== node.currentPosition[axis],
    ))
  ));
  assert.ok(bridge.solverCarrier.cages.every(cage =>
    cage.manifest.cells.every(cell =>
      cell.restRawSignedVolume * cell.restOrientationParity > 0
    )
  ));
  assert.ok(bridge.solverCarrier.cages.every(cage => {
    const fixed = cage.manifest.constraints.boundaryMasks.filter(row => row.fixed);
    return fixed.length === 18;
  }));

  const measurement = measureMuscleCompartmentRingCageContactState(
    bridge.solverCarrier,
    bridge.source,
  );
  assert.ok(measurement.pairwise.totalPenetration > 0);
  assert.equal(measurement.skeletal.totalPenetration, 0);
  assert.equal(measurement.compartment.maximumEscape, 0);
});

test('ring-cage bridge admits only the canonical manifest-derived authority profile', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const authorityProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const exerciseCounterfeitChain = counterfeitProfile => {
    const counterfeitBridge = authoredPacking.createAuthoredPackingRingCageBridge({
      manifest,
      authorityProfile:counterfeitProfile,
    });
    const expectedParent = authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({
      bridge:counterfeitBridge,
    });
    const cage = counterfeitBridge.solverCarrier.cages[0];
    const fixedNodeIds = new Set(cage.manifest.constraints.boundaryMasks
      .filter(row => row.fixed)
      .map(row => row.nodeId));
    const movableNode = cage.manifest.nodes.find(node => !fixedNodeIds.has(node.id));
    assert.ok(movableNode, 'fixture must expose a movable node for counterfeit-chain pressure');
    const origin = authoredPacking.createAuthoredPackingRealizationOrigin({
      bridge:counterfeitBridge,
      expectedParent,
      generationBasis:{
        schema:'kaminos.authored-packing-realization-origin-basis.v0',
        id:'counterfeit-authority-profile-probe',
        authority:'provisional-experimental',
      },
      coefficients:[1],
      nodeDisplacements:[{
        constructionId:cage.constructionId,
        nodeId:movableNode.id,
        displacement:[0.01, 0, 0],
      }],
    });
    return authoredPacking.validateAuthoredPackingRealizationOrigin({
      bridge:counterfeitBridge,
      expectedParent,
      origin,
    });
  };

  const staleIdentityProfile = structuredClone(authorityProfile);
  staleIdentityProfile.packingLaw.endpoints = 'counterfeit-endpoint-authority';
  staleIdentityProfile.members[0].intent.targetVolume *= 1.01;
  assert.throws(
    () => exerciseCounterfeitChain(staleIdentityProfile),
    /authority profile.*canonical manifest-derived profile/i,
    'mutated authority fields must fail before a counterfeit bridge or parent is admitted',
  );

  const rehashedProfile = structuredClone(staleIdentityProfile);
  delete rehashedProfile.identity;
  rehashedProfile.identity = {
    sha256:authoredPacking.hashAuthoredPackingCanonicalJson(rehashedProfile),
  };
  assert.throws(
    () => exerciseCounterfeitChain(rehashedProfile),
    /authority profile.*canonical manifest-derived profile/i,
    'self-consistent rehashing must not let a counterfeit profile authenticate its own bridge chain',
  );
});

test('exact bridge contacts bind the canonical authority profile to the effective solver carrier', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const restorationProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const continuationProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:mild.id,
    policy:'sculpt-continuation',
  });
  const restorationBridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile:restorationProfile,
  });
  const continuationBridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile:continuationProfile,
  });
  const restorationParent = authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({
    bridge:restorationBridge,
  });

  const restorationMeasurement = authoredPacking.measureAuthoredPackingRingCageBridgeContacts({
    manifest,
    authorityProfile:restorationProfile,
    solverCarrier:restorationBridge.solverCarrier,
    lineageBridge:restorationBridge,
    expectedParent:restorationParent,
    lineageRoot:'initialized-descendant',
  });
  assert.deepEqual(
    restorationMeasurement.source.independentlyPreservedCarrierLineage,
    {
      bridgeSha256:restorationBridge.identity.sha256,
      root:'initialized-descendant',
      rootCarrierSha256:restorationBridge.solverCarrier.identity.sha256,
      observedCarrierSha256:restorationParent.observedCarrierSha256,
      initializedCarrierSha256:restorationParent.initializedCarrierSha256,
      authorityProfileSha256:restorationProfile.identity.sha256,
      initializationSha256:restorationParent.initializationSha256,
    },
    'the measurement receipt must expose the effective independent lineage used for admission',
  );
  assert.notEqual(
    restorationProfile.identity.sha256,
    continuationProfile.identity.sha256,
    'the counterexample requires two independently valid but semantically distinct profiles',
  );
  assert.throws(
    () => authoredPacking.measureAuthoredPackingRingCageBridgeContacts({
      manifest,
      authorityProfile:continuationProfile,
      solverCarrier:restorationBridge.solverCarrier,
      lineageBridge:restorationBridge,
      expectedParent:restorationParent,
      lineageRoot:'initialized-descendant',
    }),
    /authority profile.*solver carrier source document/i,
    'canonicality of each input independently must not authorize a cross-profile measurement claim',
  );

  const relabeledCarrier = structuredClone(restorationBridge.solverCarrier);
  relabeledCarrier.sourceDocument.sha256 = continuationProfile.identity.sha256;
  delete relabeledCarrier.identity;
  relabeledCarrier.identity = {
    domain:'canonical-json-self-excluding-top-level-identity',
    sha256:hashMuscleCompartmentRingCageCanonicalJson(relabeledCarrier),
  };
  const differingNodePositions = relabeledCarrier.cages.reduce(
    (total, cage, cageIndex) => total + cage.manifest.nodes.filter((node, nodeIndex) =>
      JSON.stringify(node.currentPosition) !== JSON.stringify(
        continuationBridge.solverCarrier.cages[cageIndex].manifest.nodes[nodeIndex].currentPosition,
      )
    ).length,
    0,
  );
  assert.ok(
    differingNodePositions > 0,
    'the relabeled restoration carrier must remain geometrically distinct from canonical continuation',
  );
  assert.throws(
    () => authoredPacking.measureAuthoredPackingRingCageBridgeContacts({
      manifest,
      authorityProfile:continuationProfile,
      solverCarrier:relabeledCarrier,
      lineageBridge:restorationBridge,
      expectedParent:restorationParent,
      lineageRoot:'initialized-descendant',
    }),
    /independently preserved carrier lineage/i,
    'carrier-local relabeling and rehashing must not replace independently preserved profile lineage',
  );

  const evolvedRestorationCarrier = structuredClone(restorationBridge.solverCarrier);
  const evolvedCage = evolvedRestorationCarrier.cages[0];
  const fixedNodeIds = new Set(evolvedCage.manifest.constraints.boundaryMasks
    .filter(row => row.fixed)
    .map(row => row.nodeId));
  const evolvedNode = evolvedCage.manifest.nodes.find(node => !fixedNodeIds.has(node.id));
  assert.ok(evolvedNode, 'the fixture must expose one movable node for lawful descendant pressure');
  evolvedNode.currentPosition[0] += 0.001;
  delete evolvedRestorationCarrier.identity;
  evolvedRestorationCarrier.identity = {
    domain:'canonical-json-self-excluding-top-level-identity',
    sha256:hashMuscleCompartmentRingCageCanonicalJson(evolvedRestorationCarrier),
  };
  assert.doesNotThrow(() => authoredPacking.measureAuthoredPackingRingCageBridgeContacts({
    manifest,
    authorityProfile:restorationProfile,
    solverCarrier:evolvedRestorationCarrier,
    lineageBridge:restorationBridge,
    expectedParent:restorationParent,
    lineageRoot:'initialized-descendant',
  }), 'lawful solver-evolved geometry must remain admissible under its original preserved lineage');
});

test('plural realization origins preserve authored custody and reject counterfeit or duplicate solver starts', async () => {
  assert.equal(
    typeof authoredPacking.createAuthoredPackingRealizationOrigin,
    'function',
    'plural search requires a source-bound origin carrier before candidate generation',
  );
  assert.equal(
    typeof authoredPacking.validateAuthoredPackingRealizationOrigin,
    'function',
    'realization origins require an independently replayable custody validator',
  );
  assert.equal(
    typeof authoredPacking.assertUniqueAuthoredPackingRealizationOrigins,
    'function',
    'plural search must reject physically duplicate starts instead of counting renamed candidates',
  );

  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const authorityProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const bridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile,
  });
  const cage = bridge.solverCarrier.cages[0];
  const fixedNodeIds = new Set(cage.manifest.constraints.boundaryMasks
    .filter(row => row.fixed)
    .map(row => row.nodeId));
  const sectionIds = cage.manifest.nodes
    .filter(node => !fixedNodeIds.has(node.id))
    .map(node => node.id.match(/:section:(\d{4}):/)?.[1])
    .filter(Boolean);
  const displacedSection = [...new Set(sectionIds)].sort()[0];
  const nodeDisplacements = cage.manifest.nodes
    .filter(node => node.id.includes(`:section:${displacedSection}:`))
    .map(node => ({
      constructionId:cage.constructionId,
      nodeId:node.id,
      displacement:[0.025, -0.01, 0.015],
    }));
  const parent = authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({ bridge });
  const create = (overrides = {}) => authoredPacking.createAuthoredPackingRealizationOrigin({
    bridge,
    expectedParent:parent,
    generationBasis:{
      schema:'kaminos.authored-packing-realization-origin-basis.v0',
      id:'collective-section-translation-probe',
      authority:'provisional-experimental',
    },
    coefficients:[1],
    nodeDisplacements,
    ...overrides,
  });
  const origin = create();
  const rehashOrigin = value => {
    const rehashed = structuredClone(value);
    delete rehashed.identity;
    rehashed.identity = {
      sha256:authoredPacking.hashAuthoredPackingCanonicalJson(rehashed),
    };
    return rehashed;
  };
  const rehashCandidateCarrier = value => {
    const rehashed = structuredClone(value);
    delete rehashed.identity;
    rehashed.identity = {
      domain:'canonical-json-self-excluding-top-level-identity',
      sha256:hashMuscleCompartmentRingCageCanonicalJson(rehashed),
    };
    return rehashed;
  };
  const rehashBridgeSource = value => {
    const rehashed = structuredClone(value);
    const sourcePayload = structuredClone(rehashed.source);
    delete sourcePayload.input;
    const sourceIdentity = {
      kind:'operator-authored-fixture',
      id:sourcePayload.id,
      sha256:hashMusclePackingCanonicalJson(sourcePayload),
    };
    rehashed.source.input = {
      requested:structuredClone(sourceIdentity),
      effective:structuredClone(sourceIdentity),
    };
    return rehashed;
  };
  const rehashBridge = value => {
    const rehashed = structuredClone(value);
    delete rehashed.identity;
    rehashed.identity = {
      domain:'canonical-json-self-excluding-top-level-identity',
      sha256:authoredPacking.hashAuthoredPackingCanonicalJson(rehashed),
    };
    return rehashed;
  };
  const rehashInitialization = value => {
    const rehashed = structuredClone(value);
    delete rehashed.identity;
    rehashed.identity = {
      domain:'canonical-json-self-excluding-top-level-identity',
      sha256:authoredPacking.hashAuthoredPackingCanonicalJson(rehashed),
    };
    return rehashed;
  };

  assert.equal(origin.schema, 'kaminos.authored-packing-realization-origin.v0');
  assert.deepEqual(origin.parent, parent);
  assert.equal(origin.route.requested, 'plural-realization-origin-to-existing-global-solver-v0');
  assert.equal(origin.route.effective, origin.route.requested);
  assert.equal(origin.route.fallbackUsed, false);
  assert.ok(origin.difference.changedNodeCount > 0);
  assert.ok(origin.difference.maximumNodeDisplacement > 0);
  assert.equal(origin.difference.fixedNodeMaximumDrift, 0);
  assert.notEqual(
    origin.candidateCarrier.identity.sha256,
    bridge.solverCarrier.identity.sha256,
  );
  assert.doesNotThrow(() => authoredPacking.validateAuthoredPackingRealizationOrigin({
    bridge,
    expectedParent:parent,
    origin,
  }));
  assert.equal(
    measureMuscleCompartmentRingCageContactState(
      origin.candidateCarrier,
      bridge.source,
    ).schema,
    'kaminos.muscle-compartment-ring-cage-contact-measurement.v0',
    'the realization origin must be consumable by the existing direct global solver path',
  );

  const parentNodes = new Map(cage.manifest.nodes.map(node => [node.id, node]));
  const candidateCage = origin.candidateCarrier.cages[0];
  for (const mask of candidateCage.manifest.constraints.boundaryMasks.filter(row => row.fixed)) {
    const candidate = candidateCage.manifest.nodes.find(node => node.id === mask.nodeId);
    assert.deepEqual(candidate.currentPosition, parentNodes.get(mask.nodeId).currentPosition);
  }
  assert.deepEqual(
    origin.candidateCarrier.cages.map(row => ({
      constructionId:row.constructionId,
      sourceIdentity:row.sourceIdentity,
      restPositions:row.manifest.nodes.map(node => node.restPosition),
      cells:row.manifest.cells,
      constraints:row.manifest.constraints,
    })),
    bridge.solverCarrier.cages.map(row => ({
      constructionId:row.constructionId,
      sourceIdentity:row.sourceIdentity,
      restPositions:row.manifest.nodes.map(node => node.restPosition),
      cells:row.manifest.cells,
      constraints:row.manifest.constraints,
    })),
    'candidate origins may change only movable current positions, never source or law-bearing fields',
  );

  const fixedNodeId = cage.manifest.constraints.boundaryMasks.find(row => row.fixed).nodeId;
  assert.throws(
    () => create({
      nodeDisplacements:[{
        constructionId:cage.constructionId,
        nodeId:fixedNodeId,
        displacement:[0.01, 0, 0],
      }],
    }),
    /fixed attachment drift/i,
  );
  assert.throws(
    () => create({
      expectedParent:{ ...parent, initializedCarrierSha256:'0'.repeat(64) },
    }),
    /independently preserved parent authority mismatch/i,
  );

  assert.throws(
    () => create({
      nodeDisplacements:[{
        constructionId:cage.constructionId,
        nodeId:nodeDisplacements[0].nodeId,
        displacement:[1e-12, 0, 0],
      }],
    }),
    /physically identical/i,
    'a displacement that rounds to q9 zero cannot mint a distinct realization origin',
  );

  const displacedNodeIds = new Set(nodeDisplacements.map(row => row.nodeId));
  const dustNode = cage.manifest.nodes.find(node =>
    !fixedNodeIds.has(node.id) && !displacedNodeIds.has(node.id));
  assert.ok(dustNode, 'fixture must expose a second movable node for q9-zero row-membership pressure');
  const largePlusDust = create({
    nodeDisplacements:[
      ...nodeDisplacements,
      {
        constructionId:cage.constructionId,
        nodeId:dustNode.id,
        displacement:[1e-12, 0, 0],
      },
    ],
  });
  assert.equal(
    largePlusDust.equivalence.sha256,
    origin.equivalence.sha256,
    'adding a q9-zero row on a previously absent node must not change physical equivalence',
  );
  assert.throws(
    () => authoredPacking.assertUniqueAuthoredPackingRealizationOrigins([
      origin,
      largePlusDust,
    ]),
    /duplicate physical realization origin/i,
  );

  const forgedAuthorityBridge = structuredClone(bridge);
  forgedAuthorityBridge.authorityProfile.sha256 = '1'.repeat(64);
  assert.throws(
    () => create({ bridge:forgedAuthorityBridge }),
    /authority profile.*mismatch/i,
  );

  const forgedSourceBridge = structuredClone(bridge);
  forgedSourceBridge.source.input.requested.sha256 = '2'.repeat(64);
  forgedSourceBridge.source.input.effective.sha256 = '2'.repeat(64);
  assert.throws(
    () => create({ bridge:forgedSourceBridge }),
    /source identity.*mismatch/i,
    'matching requested/effective source strings are insufficient without payload binding',
  );

  const staleInitializationBridge = structuredClone(bridge);
  staleInitializationBridge.initialization.initializedCarrierSha256 = '3'.repeat(64);
  assert.throws(
    () => create({ bridge:staleInitializationBridge }),
    /initialization.*carrier identity mismatch/i,
  );

  const staleSourceParentBridge = structuredClone(bridge);
  staleSourceParentBridge.source.authoredPacking.observedCarrierSha256 = '4'.repeat(64);
  assert.throws(
    () => create({ bridge:staleSourceParentBridge }),
    /source authored parent identity mismatch/i,
  );

  const fallbackBridge = structuredClone(bridge);
  fallbackBridge.route.effective = 'fallback-authored-sweep';
  fallbackBridge.route.fallbackUsed = true;
  assert.throws(
    () => create({ bridge:fallbackBridge }),
    /bridge route identity mismatch/i,
  );

  const sourceForgery = structuredClone(origin);
  sourceForgery.candidateCarrier.cages[0].sourceIdentity.sourceId = 'forged-source';
  assert.throws(
    () => authoredPacking.validateAuthoredPackingRealizationOrigin({
      bridge,
      expectedParent:parent,
      origin:sourceForgery,
    }),
    /source identity substitution/i,
  );

  const missingGenerationBasis = structuredClone(origin);
  delete missingGenerationBasis.generation.basis;
  assert.throws(
    () => authoredPacking.validateAuthoredPackingRealizationOrigin({
      bridge,
      expectedParent:parent,
      origin:rehashOrigin(missingGenerationBasis),
    }),
    /generation basis schema mismatch/i,
  );

  const forgedGenerationDisplacement = structuredClone(origin);
  forgedGenerationDisplacement.generation.nodeDisplacements[0].displacementQ9[0] = String(
    Number(forgedGenerationDisplacement.generation.nodeDisplacements[0].displacementQ9[0]) + 1_000_000,
  );
  assert.throws(
    () => authoredPacking.validateAuthoredPackingRealizationOrigin({
      bridge,
      expectedParent:parent,
      origin:rehashOrigin(forgedGenerationDisplacement),
    }),
    /generation displacement.*candidate geometry mismatch/i,
    'rehashing cannot convert invented generation lineage into observed candidate geometry',
  );

  const hiddenSubQ9Motion = structuredClone(origin);
  hiddenSubQ9Motion.candidateCarrier.cages[0].manifest.nodes
    .find(node => node.id === nodeDisplacements[0].nodeId)
    .currentPosition[0] += 1e-12;
  hiddenSubQ9Motion.candidateCarrier = rehashCandidateCarrier(
    hiddenSubQ9Motion.candidateCarrier,
  );
  assert.throws(
    () => authoredPacking.validateAuthoredPackingRealizationOrigin({
      bridge,
      expectedParent:parent,
      origin:rehashOrigin(hiddenSubQ9Motion),
    }),
    /candidate geometry.*exactly reconstructed/i,
    'a rehashed candidate cannot hide sub-q9 motion outside its declared generation rows',
  );

  let rehashedAttachmentBridge = rehashBridgeSource(bridge);
  rehashedAttachmentBridge.source.muscles[0].attachments.origin.position[0] += 0.125;
  const rehashedAttachmentPayload = structuredClone(rehashedAttachmentBridge.source);
  delete rehashedAttachmentPayload.input;
  const rehashedAttachmentIdentity = {
    kind:'operator-authored-fixture',
    id:rehashedAttachmentPayload.id,
    sha256:hashMusclePackingCanonicalJson(rehashedAttachmentPayload),
  };
  rehashedAttachmentBridge.source.input = {
    requested:structuredClone(rehashedAttachmentIdentity),
    effective:structuredClone(rehashedAttachmentIdentity),
  };
  rehashedAttachmentBridge = rehashBridge(rehashedAttachmentBridge);
  assert.throws(
    () => create({ bridge:rehashedAttachmentBridge }),
    /source geometry|parent authority|bridge identity/i,
    'a source that rehashes substituted attachment geometry must not authenticate itself',
  );

  let rehashedParentSubstitution = rehashBridgeSource(bridge);
  rehashedParentSubstitution.source.muscles[0].centerline[1].radius *= 1.01;
  const rehashedParentPayload = structuredClone(rehashedParentSubstitution.source);
  delete rehashedParentPayload.input;
  const rehashedParentSourceIdentity = {
    kind:'operator-authored-fixture',
    id:rehashedParentPayload.id,
    sha256:hashMusclePackingCanonicalJson(rehashedParentPayload),
  };
  rehashedParentSubstitution.source.input = {
    requested:structuredClone(rehashedParentSourceIdentity),
    effective:structuredClone(rehashedParentSourceIdentity),
  };
  rehashedParentSubstitution = rehashBridge(rehashedParentSubstitution);
  assert.throws(
    () => create({ bridge:rehashedParentSubstitution }),
    /independently preserved parent authority mismatch/i,
    'a self-consistent new bridge identity cannot replace the caller-preserved parent authority',
  );

  let rehashedManifestBridge = rehashBridgeSource(bridge);
  rehashedManifestBridge.source.authoredPacking.manifestSha256 = 'f'.repeat(64);
  const rehashedManifestPayload = structuredClone(rehashedManifestBridge.source);
  delete rehashedManifestPayload.input;
  const rehashedManifestIdentity = {
    kind:'operator-authored-fixture',
    id:rehashedManifestPayload.id,
    sha256:hashMusclePackingCanonicalJson(rehashedManifestPayload),
  };
  rehashedManifestBridge.source.input = {
    requested:structuredClone(rehashedManifestIdentity),
    effective:structuredClone(rehashedManifestIdentity),
  };
  rehashedManifestBridge = rehashBridge(rehashedManifestBridge);
  assert.throws(
    () => create({ bridge:rehashedManifestBridge }),
    /manifest.*carrier lineage|parent authority|bridge identity/i,
    'a rehashed manifest substitution must fail against retained carrier lineage',
  );

  let counterfeitInitializationBridge = structuredClone(bridge);
  counterfeitInitializationBridge.initialization.endpointPolicy = 'counterfeit-endpoint-policy';
  counterfeitInitializationBridge.initialization.endpointDisplacements[0].maximumDisplacement += 9;
  counterfeitInitializationBridge.initialization = rehashInitialization(
    counterfeitInitializationBridge.initialization,
  );
  counterfeitInitializationBridge.source.authoredPacking.initializationSha256 =
    counterfeitInitializationBridge.initialization.identity.sha256;
  const counterfeitSourcePayload = structuredClone(counterfeitInitializationBridge.source);
  delete counterfeitSourcePayload.input;
  const counterfeitSourceIdentity = {
    kind:'operator-authored-fixture',
    id:counterfeitSourcePayload.id,
    sha256:hashMusclePackingCanonicalJson(counterfeitSourcePayload),
  };
  counterfeitInitializationBridge.source.input = {
    requested:structuredClone(counterfeitSourceIdentity),
    effective:structuredClone(counterfeitSourceIdentity),
  };
  counterfeitInitializationBridge = rehashBridge(counterfeitInitializationBridge);
  assert.throws(
    () => create({ bridge:counterfeitInitializationBridge }),
    /initialization.*policy|initialization.*ledger|parent authority|bridge identity/i,
    'a counterfeit initialization receipt cannot inherit unchanged carrier authority',
  );

  const renamedDuplicate = create({
    generationBasis:{
      schema:'kaminos.authored-packing-realization-origin-basis.v0',
      id:'renamed-but-physically-identical-probe',
      authority:'provisional-experimental',
    },
  });
  const perturbedDuplicate = create({
    nodeDisplacements:nodeDisplacements.map((row, index) => ({
      ...row,
      displacement:index === 0
        ? [row.displacement[0] + 1e-12, ...row.displacement.slice(1)]
        : row.displacement,
    })),
  });
  assert.equal(renamedDuplicate.equivalence.sha256, origin.equivalence.sha256);
  assert.equal(perturbedDuplicate.equivalence.sha256, origin.equivalence.sha256);
  assert.throws(
    () => authoredPacking.assertUniqueAuthoredPackingRealizationOrigins([
      origin,
      renamedDuplicate,
    ]),
    /duplicate physical realization origin/i,
  );
  assert.throws(
    () => authoredPacking.assertUniqueAuthoredPackingRealizationOrigins([
      origin,
      perturbedDuplicate,
    ]),
    /duplicate physical realization origin/i,
  );
});

test('collective realization-origin family emits every deterministic source-derived semantic mode', async () => {
  assert.equal(
    typeof authoredPacking.createAuthoredPackingCollectiveRealizationOriginFamily,
    'function',
    'plural search requires one explicit deterministic collective-origin family constructor',
  );

  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const authorityProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const bridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile,
  });
  const expectedParent = authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({
    bridge,
  });
  const create = () => authoredPacking.createAuthoredPackingCollectiveRealizationOriginFamily({
    bridge,
    expectedParent,
  });
  const family = create();

  assert.equal(
    typeof authoredPacking.validateAuthoredPackingCollectiveRealizationOriginFamily,
    'function',
    'collective family consumers require deterministic replay validation',
  );
  assert.deepEqual(family, create(), 'the same authenticated parent must reproduce byte-stable origins');
  assert.equal(
    authoredPacking.validateAuthoredPackingCollectiveRealizationOriginFamily({
      bridge,
      expectedParent,
      family,
    }),
    family,
  );
  const forgedFamily = structuredClone(family);
  forgedFamily.derivation.amplitudeAuthority = 'caller-selected-unearned-scale';
  forgedFamily.identity.sha256 = authoredPacking.hashAuthoredPackingCanonicalJson(
    Object.fromEntries(Object.entries(forgedFamily).filter(([key]) => key !== 'identity')),
  );
  assert.throws(
    () => authoredPacking.validateAuthoredPackingCollectiveRealizationOriginFamily({
      bridge,
      expectedParent,
      family:forgedFamily,
    }),
    /deterministic source-derived replay mismatch/,
    'a self-rehashed family-level derivation forgery must fail from its authenticated source replay',
  );
  assert.equal(family.schema, 'kaminos.authored-packing-collective-origin-family.v0');
  assert.equal(family.parent.initializedCarrierSha256, bridge.solverCarrier.identity.sha256);
  assert.deepEqual(family.directStart, {
    role:'unchanged-global-solver-control-not-a-realization-origin',
    carrierSha256:bridge.solverCarrier.identity.sha256,
  });
  assert.deepEqual(family.route, {
    requested:'source-derived-low-frequency-collective-origins-v0',
    effective:'source-derived-low-frequency-collective-origins-v0',
    fallbackUsed:false,
  });
  assert.deepEqual(family.derivation.semanticModeIds, [
    'contact-pressure-relief',
    'contact-slip-positive',
    'contact-slip-negative',
    'radial-breathing-relief',
  ]);
  assert.equal(family.derivation.longitudinalEnvelope, 'endpoint-pinned-sine-half-wave');
  assert.equal(family.derivation.vertexPolicy, 'translate-complete-ring-with-axis');
  assert.equal(family.derivation.randomness, 'none');
  assert.equal(family.population.arbitraryCandidateCap, null);
  assert.equal(family.population.definedSemanticCandidateCount, 4);
  assert.equal(family.population.emittedCandidateCount, 4);
  assert.equal(family.population.rejectedCandidateCount, 0);
  assert.equal(family.candidates.length, 4);
  assert.deepEqual(family.rejections, []);
  assert.equal(
    family.derivation.maximumDisplacementAmplitude,
    family.source.maximumMovablePairwisePenetration,
    'candidate scale must come from the authenticated source residual rather than a caller knob',
  );
  assert.match(family.source.residualLedgerSha256, /^[a-f0-9]{64}$/);
  assert.match(family.identity.sha256, /^[a-f0-9]{64}$/);

  const origins = family.candidates.map(row => row.origin);
  assert.equal(authoredPacking.assertUniqueAuthoredPackingRealizationOrigins(origins), origins);
  for (const [candidateIndex, candidate] of family.candidates.entries()) {
    assert.equal(candidate.semanticId, family.derivation.semanticModeIds[candidateIndex]);
    assert.equal(candidate.origin.generation.basis.id, candidate.semanticId);
    assert.equal(candidate.origin.generation.basis.authority, 'source-derived-provisional-experimental');
    assert.equal(
      candidate.origin.generation.basis.longitudinalEnvelope,
      'endpoint-pinned-sine-half-wave',
    );
    assert.equal(
      candidate.origin.generation.basis.vertexPolicy,
      'translate-complete-ring-with-axis',
    );
    assert.doesNotThrow(() => authoredPacking.validateAuthoredPackingRealizationOrigin({
      bridge,
      expectedParent,
      origin:candidate.origin,
    }));
    assert.equal(
      measureMuscleCompartmentRingCageContactState(
        candidate.origin.candidateCarrier,
        bridge.source,
      ).schema,
      'kaminos.muscle-compartment-ring-cage-contact-measurement.v0',
      `${candidate.semanticId} must re-enter the unchanged direct global solver surface`,
    );

    const rowsBySection = new Map();
    for (const row of candidate.origin.generation.nodeDisplacements) {
      const section = row.nodeId.match(/:section:(\d{4}):/)?.[1];
      assert.ok(section, `collective displacement must retain section identity: ${row.nodeId}`);
      const key = `${row.constructionId}|${section}`;
      const prior = rowsBySection.get(key);
      if (prior) {
        assert.deepEqual(
          row.displacementQ9,
          prior,
          `${candidate.semanticId} must translate the complete ring instead of deforming its vertices`,
        );
      } else {
        rowsBySection.set(key, row.displacementQ9);
      }
    }
    assert.ok(rowsBySection.size > 0, `${candidate.semanticId} must move at least one interior ring`);
    assert.equal(candidate.origin.difference.fixedNodeMaximumDrift, 0);
    assert.equal(candidate.admission.nonPositiveCellCount, 0);
    assert.equal(candidate.admission.fixedNodeMaximumDrift, 0);
    assert.equal(
      candidate.admission.claim,
      'mechanically-initializable-origin-only-no-packing-benefit-claim',
    );
  }

  const cleanProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:clean.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const cleanBridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile:cleanProfile,
  });
  const cleanFamily = authoredPacking.createAuthoredPackingCollectiveRealizationOriginFamily({
    bridge:cleanBridge,
    expectedParent:authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({
      bridge:cleanBridge,
    }),
  });
  assert.equal(cleanFamily.candidates.length, 0);
  assert.equal(cleanFamily.rejections.length, 4);
  assert.ok(cleanFamily.rejections.every(row =>
    row.reason === 'source-has-no-positive-movable-pairwise-penetration'
  ));
  assert.equal(cleanFamily.population.arbitraryCandidateCap, null);
  assert.equal(
    cleanFamily.population.emittedCandidateCount + cleanFamily.population.rejectedCandidateCount,
    cleanFamily.population.definedSemanticCandidateCount,
  );

  const severe = variant(manifest, 'severe-interpenetration');
  const severeProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:severe.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const severeBridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile:severeProfile,
  });
  const severeFamily = authoredPacking.createAuthoredPackingCollectiveRealizationOriginFamily({
    bridge:severeBridge,
    expectedParent:authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({
      bridge:severeBridge,
    }),
  });
  assert.equal(
    severeFamily.population.emittedCandidateCount + severeFamily.population.rejectedCandidateCount,
    severeFamily.population.definedSemanticCandidateCount,
    'stress inputs must account for every semantic mode without truncating or hiding refusals',
  );
  assert.ok(
    severeFamily.rejections.some(row =>
      row.reason === 'source-derived-origin-has-nonpositive-ring-cage-cell' &&
      row.nonPositiveCellCount > 0 &&
      /^[a-f0-9]{64}$/.test(row.attemptedOriginSha256)
    ),
    'topologically invalid stress origins must become source-linked rejection evidence',
  );
  assert.ok(severeFamily.candidates.every(row => row.admission.nonPositiveCellCount === 0));
});

test('collective trajectory assay runs direct-start and every source-derived origin through one unchanged solver contract', async () => {
  assert.equal(
    typeof authoredPacking.runAuthoredPackingCollectiveTrajectoryAssay,
    'function',
    'the reviewed origin family needs one explicit shared trajectory consumer',
  );

  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const assay = authoredPacking.runAuthoredPackingCollectiveTrajectoryAssay({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
    maximumIterations:2,
  });

  assert.equal(assay.schema, 'kaminos.authored-packing-collective-trajectory-assay.v0');
  assert.equal(assay.family.candidates.length, 4);
  assert.deepEqual(assay.family.rejections, []);
  assert.equal(assay.directStart.semanticId, 'direct-start');
  assert.equal(assay.directStart.status, 'completed');
  assert.equal(
    assay.directStart.initialCarrierSha256,
    assay.bridge.solverCarrier.identity.sha256,
  );
  assert.equal(assay.candidates.length, assay.family.derivation.semanticModeIds.length);
  assert.equal(assay.population.definedCandidateCount, 4);
  assert.equal(assay.population.completedCandidateCount, 4);
  assert.equal(assay.population.sourceRejectedCandidateCount, 0);
  assert.equal(assay.population.solverFailedCandidateCount, 0);
  assert.equal(assay.population.arbitraryCandidateCap, null);
  assert.deepEqual(assay.selection, {
    status:'not-performed',
    reason:'raw-multi-candidate-frontier-requires-comparative-and-operator-visual-disposition',
  });

  const candidateBySemanticId = new Map(
    assay.family.candidates.map(candidate => [candidate.semanticId, candidate]),
  );
  for (const [candidateIndex, outcome] of assay.candidates.entries()) {
    const semanticId = assay.family.derivation.semanticModeIds[candidateIndex];
    const sourceCandidate = candidateBySemanticId.get(semanticId);
    assert.ok(sourceCandidate, `missing source candidate ${semanticId}`);
    assert.equal(outcome.semanticId, semanticId);
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.originSha256, sourceCandidate.origin.identity.sha256);
    assert.equal(
      outcome.initialCarrierSha256,
      sourceCandidate.origin.candidateCarrier.identity.sha256,
    );
    assert.deepEqual(
      outcome.trajectory.config,
      assay.directStart.trajectory.config,
      `${semanticId} must use the direct control's unchanged solver configuration`,
    );
    assert.deepEqual(
      outcome.trajectory.gates,
      assay.directStart.trajectory.gates,
      `${semanticId} must use the direct control's unchanged gate contract`,
    );
    assert.ok(Array.isArray(outcome.trajectory.result.iterationHistory));
    assert.ok(Array.isArray(outcome.trajectory.result.lineSearchHistory));
    assert.equal(
      outcome.trajectory.exact.initial.source.solverCarrierSha256,
      outcome.initialCarrierSha256,
      `${semanticId} exact initial evidence must bind the candidate carrier actually solved`,
    );
  }

  const directControl = authoredPacking.runAuthoredPackingTrajectoryAssay({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
    maximumIterations:2,
  });
  assert.deepEqual(
    assay.directStart.trajectory,
    directControl,
    'the plural runner must preserve the complete existing direct-start control byte-for-byte',
  );

  const severe = variant(manifest, 'severe-interpenetration');
  const severeAssay = authoredPacking.runAuthoredPackingCollectiveTrajectoryAssay({
    manifest,
    observedVariantId:severe.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
    maximumIterations:1,
  });
  assert.equal(severeAssay.candidates.length, 4);
  assert.equal(severeAssay.population.completedCandidateCount, 1);
  assert.equal(severeAssay.population.sourceRejectedCandidateCount, 3);
  assert.equal(severeAssay.population.solverFailedCandidateCount, 0);
  assert.deepEqual(
    severeAssay.candidates.map(row => row.semanticId),
    severeAssay.family.derivation.semanticModeIds,
    'stress outcomes must preserve the defined semantic population order',
  );
  assert.ok(severeAssay.candidates.filter(row => row.status === 'source-rejected').every(row =>
    row.rejection.reason === 'source-derived-origin-has-nonpositive-ring-cage-cell' &&
    row.trajectory === null
  ));
});

test('accepted authored steps preserve parent, candidate, selected, and exact-contact custody', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const assay = authoredPacking.runAuthoredPackingOneStepAssay({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });

  assert.equal(assay.result.iterationHistory.length, 1);
  const accepted = assay.result.iterationHistory[0].acceptedStep;
  assert.equal(accepted.parentCarrierSha256, assay.bridge.solverCarrier.identity.sha256);
  assert.equal(accepted.candidateCarrierSha256, assay.result.packedCarrier.identity.sha256);
  assert.equal(accepted.selectedCarrierSha256, assay.result.packedCarrier.identity.sha256);
  assert.equal(accepted.fixedNodeMaximumDrift, 0);
  assert.equal(accepted.nonPositiveCellCount, 0);
  assert.equal(
    accepted.maximumRelativeVolumeError,
    Math.max(...assay.result.metrics.packed.cages.map(row => row.relativeVolumeError)),
  );
  assert.equal(
    accepted.exactContact.summary.maximumPairwisePenetration,
    assay.exact.packed.summary.maximumPairwisePenetration,
  );
  assert.ok(accepted.exactContact.summary.predictedKeys.length > 0);
  assert.equal(accepted.exactContact.summary.meshTruthKeys, null);
  assert.equal(accepted.exactContact.summary.meshTruthAgreement, null);
  assert.equal(
    accepted.exactContact.source.meshTruthAuthority,
    'unavailable-for-deformed-or-hybrid-candidate',
  );
});

test('one authored N-body step reduces exact pairwise penetration without increasing exact bone or inherited maximum volume debt', async () => {
  assert.equal(
    typeof authoredPacking.runAuthoredPackingOneStepAssay,
    'function',
    'authored packing must expose the admitted one-step solve instead of relying on an ad hoc probe',
  );
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const assay = authoredPacking.runAuthoredPackingOneStepAssay({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });

  assert.equal(assay.result.iterations, 1);
  assert.equal(assay.result.fixedNodeMaximumDrift, 0);
  assert.ok(assay.result.metrics.packed.cages.every(row => row.nonPositiveCellCount === 0));
  assert.ok(
    assay.exact.packed.summary.maximumPairwisePenetration <
      assay.exact.initial.summary.maximumPairwisePenetration,
  );
  assert.ok(
    assay.exact.packed.summary.maximumSkeletalPenetration <=
      assay.exact.initial.summary.maximumSkeletalPenetration + 1e-9,
  );
  const initialMaximumDebt = Math.max(
    ...assay.result.metrics.initial.cages.map(row => row.relativeVolumeError),
  );
  const packedMaximumDebt = Math.max(
    ...assay.result.metrics.packed.cages.map(row => row.relativeVolumeError),
  );
  assert.ok(packedMaximumDebt <= initialMaximumDebt + 1e-6);
  assert.equal(assay.config.maximumRelativeVolumeError, initialMaximumDebt + 1e-6);
});

test('exact trajectory witness keeps the authored source distinct from a continuation start', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const authorityProfile = authoredPacking.createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const bridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile,
  });
  const expectedParent = authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({
    bridge,
  });
  const problem = authoredPacking.createAuthoredPackingExactResidualProblem({
    manifest,
    authorityProfile,
    bridge,
    expectedParent,
    initialCarrier:bridge.solverCarrier,
  });
  const metrics = {
    pairwisePenetration:1,
    skeletalPenetration:1,
    compartmentEscape:0,
    endpointDrift:0,
    maximumRelativeVolumeError:0,
    rawMaximumRelativeVolumeError:0.2,
  };
  const exact = {
    variant:{ role:'mild-interpenetration' },
    pairRows:[],
    boneRows:[],
    summary:{ maximumPairwisePenetration:1, maximumSkeletalPenetration:1 },
  };
  const trajectory = {
    schema:'kaminos.authored-packing-exact-residual-trajectory.v0',
    status:'authored-exact-active-row-trajectory-local-floor',
    route:{
      requested:'authored-exact-active-row-trust-region-trajectory-v0',
      effective:'authored-exact-active-row-trust-region-trajectory-v0',
      fallbackUsed:false,
    },
    source:{
      problemSha256:problem.identity.sha256,
      initialCarrierSha256:problem.initialCarrier.identity.sha256,
      startCarrierSha256:problem.initialCarrier.identity.sha256,
      sourceInputSha256:bridge.source.input.effective.sha256,
    },
    control:'legacy-vertex-inside-relaxer-not-consumed',
    exact:{ start:exact, selected:exact },
    start:{ vector:Array(problem.variables.length).fill(0), carrier:problem.initialCarrier, metrics },
    selected:{
      vector:Array(problem.variables.length).fill(0),
      carrier:problem.initialCarrier,
      metrics,
    },
    work:{ rows:[] },
  };
  const visualRoute = {
    requested:'authored-packing-exact-residual-trajectory-orbitable-v0',
    effective:'authored-packing-exact-residual-trajectory-orbitable-v0',
    fallbackUsed:false,
  };
  const bundleIdentity = {
    sha256:'a'.repeat(64),
    familySha256:problem.identity.sha256,
    sourceCarrierSha256:problem.initialCarrier.identity.sha256,
    authoredSourceCarrierSha256:bridge.observedCarrier.identity.sha256,
    armIdentities:[{
      semanticId:'exact-active-row-trajectory',
      initialCarrierSha256:problem.initialCarrier.identity.sha256,
      packedCarrierSha256:problem.initialCarrier.identity.sha256,
    }],
    route:visualRoute.effective,
  };
  const html = contactWitness.renderAuthoredPackingExactResidualTrajectoryHtml({
    problem,
    trajectory,
    source:bridge.source,
    route:visualRoute,
    bundleIdentity,
    presentation:{
      authoredBone:{ positions:mild.bone.mesh.vertices, faces:mild.bone.mesh.polygons },
    },
  });
  assert.match(
    html,
    new RegExp(`"sourceGhostCarrierSha256":"${bridge.observedCarrier.identity.sha256}"`),
    'the authored-source diagnostic must bind the actual observed carrier, not relabel the continuation start as authored source',
  );
  assert.match(
    html,
    /dataset\.witnessAuthoredSourceCarrier=payload\.sourceGhostCarrierSha256/,
    'capture evidence must expose the effective authored-source carrier identity',
  );
});

test('authored exact-residual problem exposes fixed-endpoint ring motion to the global active-row search law', async () => {
  assert.equal(
    typeof authoredPacking.createAuthoredPackingExactResidualProblem,
    'function',
    'the authored carrier needs an explicit exact-residual problem instead of impersonating the tapered synthetic carrier',
  );
  assert.equal(typeof authoredPacking.evaluateAuthoredPackingExactResidualState, 'function');
  assert.equal(typeof authoredPacking.solveAuthoredPackingExactResidualStep, 'function');
  assert.equal(typeof authoredPacking.createAuthoredPackingExactResidualTrajectoryConfig, 'function');
  assert.equal(typeof authoredPacking.solveAuthoredPackingExactResidualTrajectory, 'function');
  const exactTrustRegionRadii =
    authoredPacking.createAuthoredPackingExactResidualStepConfig().trustRegionRadii;
  assert.ok(
    exactTrustRegionRadii.includes(0.000244140625),
    'the exact authored schedule must include the measured lawful radius below the former adapter floor',
  );
  assert.equal(
    exactTrustRegionRadii.at(-1),
    0.000000001862645149230957,
    'the exact adapter must preserve the mature search law through its full supported scale rather than imposing a shallower local cap',
  );

  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const authorityProfile = authoredPacking.createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const bridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile,
  });
  const expectedParent = authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({
    bridge,
  });
  const problem = authoredPacking.createAuthoredPackingExactResidualProblem({
    manifest,
    authorityProfile,
    bridge,
    expectedParent,
    initialCarrier:bridge.solverCarrier,
  });

  assert.equal(problem.schema, 'kaminos.authored-packing-exact-residual-problem.v0');
  assert.equal(problem.route.requested, 'exact-authored-tetrahedral-family-residuals-v0');
  assert.equal(problem.route.effective, problem.route.requested);
  assert.equal(problem.route.fallbackUsed, false);
  assert.equal(problem.variables.length, manifest.memberOrder.length * 3);
  assert.ok(problem.variables.every(row => row.basis === 'first-sine-zero-at-fixed-attachments'));

  const zero = Array(problem.variables.length).fill(0);
  const state = authoredPacking.evaluateAuthoredPackingExactResidualState({ problem, vector:zero });
  assert.equal(state.route.effective, problem.route.effective);
  assert.equal(state.route.fallbackUsed, false);
  assert.equal(state.rows.filter(row => row.kind === 'pairwise-clearance').length, 15);
  assert.equal(state.rows.filter(row => row.kind === 'skeletal-clearance').length, 6);
  assert.ok(state.rows.every(row => Number.isFinite(row.signedGap)));
  assert.equal(
    state.metrics.pairwisePenetration,
    state.exactContact.summary.admittedMaximumPairwisePenetration,
  );
  assert.equal(
    state.metrics.skeletalPenetration,
    state.exactContact.summary.admittedMaximumSkeletalPenetration,
  );
  assert.equal(
    state.metrics.rawPairwisePenetration,
    state.exactContact.summary.maximumPairwisePenetration,
  );
  assert.equal(
    state.metrics.rawSkeletalPenetration,
    state.exactContact.summary.maximumSkeletalPenetration,
  );
  assert.equal(state.metrics.endpointDrift, 0);
  assert.equal(state.metrics.maximumRelativeVolumeError, 0);

  const displaced = [...zero];
  displaced[0] = 0.01;
  const moved = authoredPacking.evaluateAuthoredPackingExactResidualState({
    problem,
    vector:displaced,
  });
  assert.notEqual(moved.carrier.identity.sha256, state.carrier.identity.sha256);
  assert.equal(moved.metrics.endpointDrift, 0);
  assert.equal(
    bridge.solverCarrier.identity.sha256,
    problem.initialCarrierSha256,
    'evaluation must not mutate the authenticated initial carrier',
  );

  const step = authoredPacking.solveAuthoredPackingExactResidualStep({
    problem,
    startVector:zero,
    requestedConfig: {
      ...authoredPacking.createAuthoredPackingExactResidualStepConfig(),
      trustRegionRadii:[0.01, 0.005, 0.0025],
    },
  });
  assert.equal(step.route.requested, 'authored-exact-active-row-trust-region-step-v0');
  assert.equal(step.route.effective, step.route.requested);
  assert.equal(step.route.fallbackUsed, false);
  assert.equal(step.control, 'legacy-vertex-inside-relaxer-not-consumed');
  assert.ok([
    'authored-exact-active-row-step-accepted',
    'authored-exact-active-row-local-floor',
  ].includes(step.status));
  assert.ok(step.exact.start.summary.maximumPairwisePenetration > 0);
  if (step.status === 'authored-exact-active-row-step-accepted') {
    assert.ok(
      step.exact.selected.summary.maximumPairwisePenetration <
        step.exact.start.summary.maximumPairwisePenetration,
    );
  } else {
    assert.ok(step.certificate, 'an unaccepted exact step must return the local obstruction');
  }

  const continuationStart = zero.map((value, index) => index === 0 ? 0.01 : value);
  const trajectory = authoredPacking.solveAuthoredPackingExactResidualTrajectory({
    problem,
    startVector:continuationStart,
    requestedConfig:authoredPacking.createAuthoredPackingExactResidualTrajectoryConfig({
      iterationBudget:2,
      step:{
        ...authoredPacking.createAuthoredPackingExactResidualStepConfig(),
        trustRegionRadii:[0.01, 0.005, 0.0025],
      },
    }),
  });
  assert.equal(
    trajectory.route.requested,
    'authored-exact-active-row-trust-region-trajectory-v0',
  );
  assert.equal(trajectory.route.effective, trajectory.route.requested);
  assert.equal(trajectory.route.fallbackUsed, false);
  assert.equal(trajectory.control, 'legacy-vertex-inside-relaxer-not-consumed');
  assert.ok(trajectory.work.attempts >= 1);
  assert.ok(trajectory.work.attempts <= 2);
  assert.ok(trajectory.work.rows.every(row => row.stepResultSha256));
  assert.equal(
    trajectory.start.carrier.identity.sha256,
    authoredPacking.evaluateAuthoredPackingExactResidualState({
      problem,
      vector:trajectory.start.vector,
    }).carrier.identity.sha256,
    'a trajectory witness must bind exact start geometry even when the run is a nonzero continuation',
  );
  assert.equal(
    trajectory.source.startCarrierSha256,
    trajectory.start.carrier.identity.sha256,
    'the route receipt must name the effective start carrier separately from the root problem carrier',
  );
  assert.notEqual(
    trajectory.source.startCarrierSha256,
    problem.initialCarrier.identity.sha256,
    'the continuation witness must not silently substitute the root carrier for a nonzero start vector',
  );
  assert.equal(trajectory.selected.metrics.endpointDrift, 0);
  assert.equal(trajectory.selected.metrics.maximumRelativeVolumeError, 0);
  assert.ok(
    trajectory.exact.selected.summary.maximumPairwisePenetration <=
      trajectory.exact.start.summary.maximumPairwisePenetration,
  );
  assert.equal(
    trajectory.mechanism.stateEvaluatorRoute.effective,
    'exact-authored-tetrahedral-family-residuals-v0',
  );

  assert.equal(
    typeof contactWitness.renderAuthoredPackingExactResidualTrajectoryHtml,
    'function',
    'the exact global search result needs its own causal witness instead of inheriting the legacy relaxer viewer labels',
  );
  const visualRoute = {
    requested:'authored-packing-exact-residual-trajectory-orbitable-v0',
    effective:'authored-packing-exact-residual-trajectory-orbitable-v0',
    fallbackUsed:false,
  };
  const bundleIdentity = {
    schema:'kaminos.authored-packing-exact-residual-trajectory-visual-bundle.v0',
    sha256:'d'.repeat(64),
    generation:'e'.repeat(64),
    familySha256:problem.identity.sha256,
    sourceCarrierSha256:trajectory.start.carrier.identity.sha256,
    authoredSourceCarrierSha256:bridge.observedCarrier.identity.sha256,
    armIdentities:[{
      semanticId:'exact-active-row-trajectory',
      initialCarrierSha256:trajectory.start.carrier.identity.sha256,
      packedCarrierSha256:trajectory.selected.carrier.identity.sha256,
      residualLedgerSha256:'f'.repeat(64),
    }],
    route:visualRoute.effective,
  };
  const html = contactWitness.renderAuthoredPackingExactResidualTrajectoryHtml({
    problem,
    trajectory,
    source:bridge.source,
    route:visualRoute,
    bundleIdentity,
    presentation:{
      authoredBone:{
        positions:mild.bone.mesh.vertices,
        faces:mild.bone.mesh.polygons,
      },
    },
  });
  assert.match(html, /Exact authored global trajectory/i);
  assert.match(html, /exact tetrahedral residual families/i);
  assert.match(html, /GLOBAL SEARCH START/i);
  assert.match(html, /AFTER <span id="solver-step-count">N<\/span> ACCEPTED GLOBAL STEPS/i);
  assert.match(html, /legacy vertex-inside relaxer not consumed/i);
  assert.doesNotMatch(html, /starting-state strategies/i);
  assert.doesNotMatch(html, /same bounded legacy contact relaxer/i);
  assert.match(html, /data-diagnostic="contacts"/);
  assert.match(html, /new ConvexGeometry\(points\)/);

  const floorTrajectory = structuredClone(trajectory);
  floorTrajectory.status = 'authored-exact-active-row-trajectory-local-floor';
  floorTrajectory.work.rows.push({
    ...structuredClone(floorTrajectory.work.rows.at(-1)),
    iteration:floorTrajectory.work.rows.length + 1,
    accepted:false,
  });
  floorTrajectory.work.attempts = floorTrajectory.work.rows.length;
  const acceptedStepCount = trajectory.work.rows.filter(row => row.accepted).length;
  const floorHtml = contactWitness.renderAuthoredPackingExactResidualTrajectoryHtml({
    problem,
    trajectory:floorTrajectory,
    source:bridge.source,
    route:visualRoute,
    bundleIdentity,
    presentation:{
      authoredBone:{
        positions:mild.bone.mesh.vertices,
        faces:mild.bone.mesh.polygons,
      },
    },
  });
  assert.match(
    floorHtml,
    new RegExp(`"iterations":${acceptedStepCount}`),
    'an unaccepted terminal attempt must not be presented as an accepted solver step',
  );
});

test('authored exact residual admission does not resurrect a sub-tolerance non-contact as skeletal family debt', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const authorityProfile = authoredPacking.createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const bridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile,
  });
  const expectedParent = authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({
    bridge,
  });
  const problem = authoredPacking.createAuthoredPackingExactResidualProblem({
    manifest,
    authorityProfile,
    bridge,
    expectedParent,
    initialCarrier:bridge.solverCarrier,
  });
  const terminalBoundaryCandidate = [
    1.89158220463222,
    0.069825356250897,
    0.805485883285688,
    0.566899233585648,
    -0.024098961179734,
    -1.27729502819462,
    0.614066665168394,
    0.365002297312511,
    2.964514510133601,
    -2.04442776027165,
    -0.06553002350901,
    -0.687032408190818,
    -0.499200510419071,
    0.05310367779342,
    0.497974748157125,
    -0.008826549297801,
    -0.016885957574312,
    -0.201629129735106,
  ];
  const state = authoredPacking.evaluateAuthoredPackingExactResidualState({
    problem,
    vector:terminalBoundaryCandidate,
  });
  const rawBoneRow = state.exactContact.boneRows.find(
    row => row.key === 'central-bone|muscle-2',
  );
  const solverBoneRow = state.rows.find(
    row => row.key === 'bone:central-bone|muscle-2',
  );

  assert.equal(
    problem.admission.exactContactTolerance,
    state.exactContact.method.contactTolerance,
    'the problem admission and exact-contact classifier must consume one tolerance law',
  );
  assert.equal(rawBoneRow.intersects, false);
  assert.ok(rawBoneRow.signedGap >= 0);
  assert.ok(rawBoneRow.maximumPenetration > 0);
  assert.ok(
    rawBoneRow.maximumPenetration < problem.admission.exactContactTolerance,
    'the raw SAT overlap must remain below the authority-bearing exact-contact tolerance',
  );
  assert.ok(solverBoneRow.signedGap >= 0);
  assert.equal(
    state.exactContact.summary.admittedMaximumSkeletalPenetration,
    0,
    'the exact summary must distinguish admitted residual depth from raw diagnostic SAT depth',
  );
  assert.equal(state.metrics.rawSkeletalPenetration, rawBoneRow.maximumPenetration);
  assert.equal(
    state.metrics.skeletalPenetration,
    0,
    'a row classified as a non-contact must not reappear as family debt through a stricter unrelated threshold',
  );
});

test('authored exact search enriches its working set when a useful candidate crosses a clear bone row', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const authorityProfile = authoredPacking.createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const bridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile,
  });
  const expectedParent = authoredPacking.createAuthoredPackingRealizationOriginParentEnvelope({
    bridge,
  });
  const problem = authoredPacking.createAuthoredPackingExactResidualProblem({
    manifest,
    authorityProfile,
    bridge,
    expectedParent,
    initialCarrier:bridge.solverCarrier,
  });
  const startVector = [
    1.89158220463222,
    0.069825356250897,
    0.805485883285688,
    0.566899233585648,
    -0.024098961179734,
    -1.27729502819462,
    0.614066665168394,
    0.365002297312511,
    2.964514510133601,
    -2.04442776027165,
    -0.06553002350901,
    -0.687032408190818,
    -0.499200510419071,
    0.05310367779342,
    0.497974748157125,
    -0.008826549297801,
    -0.016885957574312,
    -0.201629129735106,
  ];
  const start = authoredPacking.evaluateAuthoredPackingExactResidualState({
    problem,
    vector:startVector,
  });
  const blockingBone = start.rows.find(
    row => row.key === 'bone:central-bone|muscle-2',
  );
  assert.ok(blockingBone.signedGap > 0, 'the blocking bone row must start clear');

  const requestedConfig = authoredPacking.createAuthoredPackingExactResidualStepConfig();
  assert.equal(
    requestedConfig.guardRowPolicy,
    'candidate-crossing-clear-rows',
    'the exact authored route must opt into evidence-driven guard-row enrichment',
  );
  const trajectory = authoredPacking.solveAuthoredPackingExactResidualTrajectory({
    problem,
    startVector,
    requestedConfig:authoredPacking.createAuthoredPackingExactResidualTrajectoryConfig({
      iterationBudget:1,
      step:requestedConfig,
    }),
  });

  assert.equal(trajectory.work.rows.length, 1);
  const row = trajectory.work.rows[0];
  assert.equal(row.accepted, true);
  assert.ok(row.work, 'the exact trajectory row must preserve step-local work custody');
  assert.ok(row.work.guardRowExchanges.length > 0);
  assert.equal(
    trajectory.work.evaluationCount,
    row.work.evaluationCount + trajectory.work.selectedStateEvaluationCount,
    'the exact trajectory must preserve reconcilable step-local and terminal work accounting',
  );
  assert.ok(
    row.work.guardRowExchanges.some(exchange =>
      exchange.addedConstraintKeys.includes('bone:central-bone|muscle-2')
    ),
    'the nonlinear candidate that crosses the clear authored bone must promote that row into direction construction',
  );
  assert.ok(
    row.directionConstruction.activeRows.some(
      row => row.key === 'bone:central-bone|muscle-2',
    ),
  );
  assert.ok(trajectory.selected.metrics.pairwisePenetration < start.metrics.pairwisePenetration);
  assert.equal(trajectory.selected.metrics.skeletalPenetration, 0);
  assert.equal(trajectory.selected.metrics.compartmentEscape, 0);
  assert.equal(trajectory.selected.metrics.endpointDrift, 0);
  assert.equal(trajectory.selected.metrics.maximumRelativeVolumeError, 0);
});

test('ring-cage witness renders six authored bodies and the exact authored bone without a synthetic capsule', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const assay = authoredPacking.runAuthoredPackingOneStepAssay({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const residualLedger = measureMuscleCompartmentRingCageContactResidualLedger(
    assay.result.packedCarrier,
    assay.bridge.source,
  );
  const bundleIdentity = {
    sha256:'a'.repeat(64),
    observedCarrierSha256:assay.bridge.observedCarrier.identity.sha256,
    initializedCarrierSha256:assay.bridge.solverCarrier.identity.sha256,
    packedCarrierSha256:assay.result.packedCarrier.identity.sha256,
    residualLedgerSha256:'b'.repeat(64),
  };
  const html = renderMuscleCompartmentRingCageContactHtml({
    observedCarrier:assay.bridge.observedCarrier,
    initializedCarrier:assay.bridge.solverCarrier,
    result:assay.result,
    source:assay.bridge.source,
    route:{ requested:'authored-fixture-one-step-v0', effective:'authored-fixture-one-step-v0' },
    bundleIdentity,
    residualLedger,
    presentation: {
      authorityLabel:'Operator-authored fixture · provisional packing assay',
      authoredBone: {
        positions:mild.bone.mesh.vertices,
        faces:mild.bone.mesh.polygons,
      },
      exactContact:assay.exact,
    },
  });

  assert.match(html, /Operator-authored fixture · provisional packing assay/);
  assert.match(html, /const colors=\[[^\]]+(?:,[^\]]+){5}\]/);
  assert.match(html, /"authoredBone":\{"positions":/);
  assert.match(html, /if\(payload\.authoredBone\)/);
  assert.match(html, /exact authored bone max/);
  assert.match(
    html,
    /sourceBoundaryGhostGroup/,
    'packed view must retain the exact source boundary as a displacement reference',
  );
  assert.match(
    html,
    /displacementGroup\.add\(pressureLine/,
    'packed view must show per-ring source-to-proposal displacement segments',
  );
  assert.match(html, /source boundary \/ ring displacement/);
  assert.match(html, /data-state="observed"/);
  assert.match(html, /data-state="initialized"/);
  assert.match(html, /data-state="packed"/);
  assert.match(html, /data-diagnostic="wireframe"/);
  assert.match(html, /data-diagnostic="source-ghost"/);
  assert.match(html, /data-diagnostic="displacement"/);
  assert.match(html, /data-diagnostic="contacts"/);
  assert.doesNotMatch(
    html,
    /sourceBoundaryGhostGroup\.visible=packed; displacementGroup\.visible=packed; contactGroup\.visible=packed/,
    'changing comparison state must not silently change diagnostic overlays',
  );
  assert.match(html, /exactContactByState/);
  assert.match(html, /stateContactGroups/);
  assert.match(html, /diagnostics\.contacts&&state===currentState/);
  assert.match(html, /viewMode==='contact'/);
  assert.match(
    html,
    /Math\.max\(framingRadius\*\.82,strongestContact\.maximumPenetration\*5\)/,
    'contact focus must retain enough compartment context to keep the intersecting bodies legible',
  );
  assert.match(
    html,
    /stateContactGroups\[state\]\.add\(witnessBeam/,
    'exact contact localization must remain visible at compartment scale instead of relying on one-pixel lines',
  );
  assert.match(
    html,
    /if\(viewMode==='contact'\).*\.material\.opacity=/s,
    'contact focus must reduce surface occlusion without changing comparison geometry',
  );
  assert.match(html, /exact movable pairwise family witness/);
  assert.match(html, /exact skeletal family witness/);
  assert.match(html, /solver init/);
  assert.match(
    html,
    /diagnostic-controls[\s\S]*id="contact-families"[\s\S]*class="metrics"/,
    'contact family identity must remain visible beside the contact controls instead of below the scroll-heavy metric ledger',
  );
  assert.match(html, /strongest → /);
});

test('collective trajectory witness compares every admitted arm with symmetric presentation and independent diagnostics', async () => {
  assert.equal(
    typeof contactWitness.renderAuthoredPackingCollectiveTrajectoryHtml,
    'function',
    'plural trajectories need one same-camera visual frontier instead of isolated screenshots',
  );

  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const assay = authoredPacking.runAuthoredPackingCollectiveTrajectoryAssay({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
    maximumIterations:1,
  });
  const arms = [assay.directStart, ...assay.candidates]
    .filter(row => row.status === 'completed')
    .map(row => ({
      semanticId:row.semanticId,
      label:row.semanticId,
      status:row.status,
      trajectory:row.trajectory,
      residualLedger:measureMuscleCompartmentRingCageContactResidualLedger(
        row.trajectory.result.packedCarrier,
        assay.bridge.source,
      ),
    }));
  const bundleIdentity = {
    schema:'kaminos.authored-packing-collective-trajectory-visual-bundle.v0',
    sha256:'a'.repeat(64),
    generation:'b'.repeat(64),
    familySha256:assay.family.identity.sha256,
    sourceCarrierSha256:assay.bridge.observedCarrier.identity.sha256,
    armIdentities:arms.map(arm => ({
      semanticId:arm.semanticId,
      initialCarrierSha256:arm.trajectory.exact.initial.source.solverCarrierSha256,
      packedCarrierSha256:arm.trajectory.result.packedCarrier.identity.sha256,
      residualLedgerSha256:'c'.repeat(64),
    })),
    route:'authored-packing-collective-trajectory-orbitable-v0',
  };
  const html = contactWitness.renderAuthoredPackingCollectiveTrajectoryHtml({
    assay,
    arms,
    source:assay.bridge.source,
    route:{
      requested:'authored-packing-collective-trajectory-orbitable-v0',
      effective:'authored-packing-collective-trajectory-orbitable-v0',
      fallbackUsed:false,
    },
    bundleIdentity,
    presentation:{
      authoredBone:{
        positions:mild.bone.mesh.vertices,
        faces:mild.bone.mesh.polygons,
      },
    },
  });

  for (const arm of arms) assert.match(html, new RegExp(`data-arm="${arm.semanticId}"`));
  assert.match(html, /data-phase="initial"/);
  assert.match(html, /data-phase="packed"/);
  assert.match(html, /MILD INTERPENETRATION CONDITION/i);
  assert.match(html, /starting-state strategies · not solver configurations/i);
  assert.match(html, /STARTING STATE/i);
  assert.match(html, /AFTER <span id="solver-step-count">N<\/span> SOLVER STEPS/i);
  assert.match(html, /data-render="solid"/);
  assert.match(html, /data-render="xray"/);
  assert.match(html, /data-diagnostic="contacts"/);
  assert.match(html, /data-diagnostic="source-ghost"/);
  assert.match(html, /data-diagnostic="motion-ghost"/);
  assert.doesNotMatch(html, /data-diagnostic="wireframe"/);
  assert.doesNotMatch(html, /data-diagnostic="displacement"/);
  assert.match(
    html,
    /motionGhosts\[arm\.semanticId\]=new THREE\.Group\(\)/,
    'each starting-state strategy must own a whole-surface motion ghost',
  );
  assert.match(
    html,
    /group\.visible=diagnostics\.motionGhost&&armId===currentArm/,
    'the motion ghost must remain local to the selected starting-state strategy',
  );
  assert.match(
    html,
    /diagnosticScale=Math\.max\(/,
    'diagnostic geometry must derive its visible scale from the authored compartment instead of using synthetic-scene constants',
  );
  assert.match(
    html,
    /diagnosticAvailability=\{contacts:groups\.contacts\.children\.length>0,sourceGhost:cagesDiffer\(currentCages,payload\.sourceCages\),motionGhost:motionGhosts\[currentArm\]\.children\.length>0&&currentPhase==='packed'\}/,
    'each selected strategy and phase must declare which diagnostic controls can produce a visible effect',
  );
  assert.match(
    html,
    /button\.disabled=!diagnosticAvailability\[key\]/,
    'diagnostic controls with no visible effect must be visibly disabled instead of pretending to actuate',
  );
  assert.match(html, /witnessDiagnosticAvailability/);
  assert.match(html, /witnessDiagnosticsActive/);
  assert.match(html, /witnessDiagnosticsActive=.*\.join\(','\)\|\|'none'/);
  assert.match(
    html,
    /groups\.contacts\.add\(intersectionVolume\(row\.witness\.intersectionVertices/,
    'contact mode must render the exact deepest tetrahedral intersection volume instead of a centroid beam',
  );
  assert.match(
    html,
    /motionGhosts\[arm\.semanticId\]\.add\(cageMesh\(initialCage/,
    'origin-to-packed motion must use a whole-surface ghost instead of interior centerline points',
  );
  assert.match(html, /new ConvexGeometry\(points\)/);
  assert.match(html, /renderMode==='xray'/);
  assert.match(html, /same camera · same materials · overlays independent/i);
  assert.match(html, /selection not performed/i);
  assert.match(html, /source-rejected/);
  assert.match(html, /identity-bound collective capture route mismatch/);
  assert.match(html, /witnessRenderComplete/);
  assert.match(html, /0 solver steps · unchanged/i);
});

test('collective trajectory runner publishes one immutable identity-bound frontier generation', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-collective-frontier-'));
  try {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const runner = path.join(root, 'tools/run-authored-packing-collective-trajectory-assay.mjs');
    const result = spawnSync(process.execPath, [
      runner,
      '--manifest', fileURLToPath(FIXTURE_URL),
      '--output', output,
      '--observed-role', 'mild-interpenetration',
      '--intent-role', 'clean-reference',
      '--policy', 'restoration-to-reference',
      '--iterations', '1',
    ], { cwd:root, encoding:'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
    assert.equal(report.status, 'completed');
    assert.match(report.generation, /^[a-f0-9]{64}$/);
    assert.equal(report.publishedGeneration, `generations/${report.generation}`);
    assert.deepEqual(report.route, {
      requested:'authored-packing-collective-trajectory-orbitable-v0',
      effective:'authored-packing-collective-trajectory-orbitable-v0',
      fallbackUsed:false,
    });
    assert.deepEqual(report.selection, {
      status:'not-performed',
      reason:'raw-multi-candidate-frontier-requires-comparative-and-operator-visual-disposition',
    });
    assert.equal(report.population.definedCandidateCount, 4);
    assert.equal(report.population.completedCandidateCount, 4);
    assert.equal(report.visual.captureUrls.length, 10);
    assert.deepEqual(report.visual.viewer, report.outputs.viewer);
    const frontier = JSON.parse(await readFile(
      path.join(output, report.outputs.frontier.path),
      'utf8',
    ));
    assert.equal(frontier.status, 'completed-raw-frontier-selection-not-performed');
    assert.equal(frontier.arms.length, 5);
    assert.equal(frontier.arms.filter(row => row.status === 'completed').length, 5);
    const viewer = await readFile(path.join(output, report.outputs.viewer.path), 'utf8');
    assert.match(viewer, new RegExp(report.visual.bundleIdentity.sha256));
    assert.match(viewer, /witnessRouteEffective/);
    assert.ok((await readdir(output)).every(relative => !relative.startsWith('.staging-')));
  } finally {
    await rm(output, { recursive:true, force:true });
  }
});

test('collective trajectory runner preserves a failure report without publishing partial primary evidence', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-collective-failure-'));
  try {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const runner = path.join(root, 'tools/run-authored-packing-collective-trajectory-assay.mjs');
    const result = spawnSync(process.execPath, [
      runner,
      '--manifest', path.join(output, 'missing.json'),
      '--output', output,
    ], { cwd:root, encoding:'utf8' });
    assert.notEqual(result.status, 0);
    const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'read-manifest');
    assert.equal(report.publishedGeneration, null);
    assert.equal(report.outputs, null);
    assert.deepEqual(await readdir(output), ['run-report.json']);
  } finally {
    await rm(output, { recursive:true, force:true });
  }
});

test('authored trajectory runner writes a failure report and no primary artifacts when source identity is unavailable', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-packing-failure-'));
  try {
    const runner = fileURLToPath(new URL(
      '../tools/run-authored-packing-trajectory-assay.mjs',
      import.meta.url,
    ));
    const missingManifest = path.join(output, 'missing-manifest.json');
    const staleArtifacts = [
      'assay-result.json',
      'index.html',
      'capture-route-verification.json',
      'source-crowded.png',
      'source-crowded-report.json',
      'contact-relieved.png',
      'contact-relieved-report.json',
    ];
    for (const relative of staleArtifacts) {
      await writeFile(path.join(output, relative), 'stale prior generation');
    }
    await writeFile(path.join(output, 'run-report.json'), JSON.stringify({
      status:'completed',
      generation:'stale-prior-generation',
    }));
    const result = spawnSync(process.execPath, [
      runner,
      '--manifest', missingManifest,
      '--output', output,
    ], {
      cwd:fileURLToPath(new URL('..', import.meta.url)),
      encoding:'utf8',
    });
    assert.notEqual(result.status, 0);
    const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'read-manifest');
    assert.equal(report.outputs, null);
    assert.match(report.generation, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readdir(output), ['run-report.json']);
  } finally {
    await rm(output, { recursive:true, force:true });
  }
});

test('authored trajectory publishes the new generation before invalidation can be interrupted', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-packing-interruption-'));
  let child = null;
  try {
    const runner = fileURLToPath(new URL(
      '../tools/run-authored-packing-trajectory-assay.mjs',
      import.meta.url,
    ));
    const priorGeneration = '7'.repeat(64);
    await writeFile(path.join(output, 'assay-result.json'), 'stale primary artifact');
    await writeFile(path.join(output, 'capture-route-verification.json'), JSON.stringify({
      status:'verified',
      generation:priorGeneration,
    }));
    await writeFile(path.join(output, 'run-report.json'), JSON.stringify({
      status:'completed',
      generation:priorGeneration,
    }));
    child = spawn(process.execPath, [
      runner,
      '--manifest', path.join(output, 'missing-manifest.json'),
      '--output', output,
    ], {
      cwd:fileURLToPath(new URL('..', import.meta.url)),
      env:{
        ...process.env,
        NODE_ENV:'test',
        KAMINOS_AUTHORED_PACKING_TEST_INVALIDATION_PAUSE_MS:'20000',
      },
      stdio:'ignore',
    });
    let closed = false;
    const closePromise = new Promise(resolve => child.once('close', code => {
      closed = true;
      resolve(code);
    }));
    let currentReport = null;
    for (let attempt = 0; attempt < 150 && !closed; attempt += 1) {
      currentReport = await readFile(path.join(output, 'run-report.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      const stalePrimaryWasInvalidated = !await readFile(path.join(output, 'assay-result.json'))
        .then(() => true)
        .catch(() => false);
      if (currentReport?.status === 'in-progress' && stalePrimaryWasInvalidated) break;
      await delay(10);
    }
    assert.equal(currentReport?.status, 'in-progress');
    assert.match(currentReport.generation, /^[a-f0-9]{64}$/);
    assert.notEqual(currentReport.generation, priorGeneration);
    child.kill('SIGKILL');
    await closePromise;
    child = null;

    const staleVerification = JSON.parse(await readFile(
      path.join(output, 'capture-route-verification.json'),
      'utf8',
    ));
    assert.equal(staleVerification.generation, priorGeneration);
    assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
      runReport:currentReport,
      servedViewer:null,
      captureReports:[],
    }), /completed assay run/i);
  } finally {
    child?.kill('SIGKILL');
    await rm(output, { recursive:true, force:true });
  }
});

test('authored trajectory report binds the served viewer and route inside the visual receipt envelope', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-packing-visual-envelope-'));
  try {
    const runner = fileURLToPath(new URL(
      '../tools/run-authored-packing-trajectory-assay.mjs',
      import.meta.url,
    ));
    const result = spawnSync(process.execPath, [
      runner,
      '--manifest', fileURLToPath(FIXTURE_URL),
      '--output', output,
      '--observed-role', 'mild-interpenetration',
      '--intent-role', 'clean-reference',
      '--policy', 'restoration-to-reference',
      '--iterations', '1',
    ], {
      cwd:fileURLToPath(new URL('..', import.meta.url)),
      encoding:'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
    assert.equal(
      report.requestedManifestPath,
      'repo://fixtures/authored-packing/packing-fixture-v001.json',
      'durable reports must not leak the generating host path for a repo-owned fixture',
    );
    assert.deepEqual(report.visual.route, report.route);
    assert.deepEqual(report.visual.viewer, report.outputs.viewer);
    assert.equal(report.visual.bundleIdentity.route, report.visual.route.effective);
    const contactViews = report.visual.captureUrls.filter(url =>
      new URL(url, 'http://fixture.invalid/').searchParams.get('view') === 'contact'
    );
    assert.deepEqual(
      contactViews.map(url => new URL(url, 'http://fixture.invalid/').searchParams.get('state')),
      ['observed', 'initialized', 'packed'],
    );
    assert.ok(contactViews.every(url =>
      new URL(url, 'http://fixture.invalid/').searchParams.get('diagnostics') === 'contacts'
    ));
    const viewerHtml = await readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(
      viewerHtml,
      /witnessRenderComplete/,
      'the viewer must publish render completion only after an actual rendered frame',
    );
  } finally {
    await rm(output, { recursive:true, force:true });
  }
});

test('authored recapture publishes a new batch and invalidates old verification before replacing pixels', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-capture-transition-'));
  let child = null;
  try {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const run = spawnSync(process.execPath, [
      path.join(root, 'tools/run-authored-packing-trajectory-assay.mjs'),
      '--manifest', fileURLToPath(FIXTURE_URL),
      '--output', output,
      '--observed-role', 'mild-interpenetration',
      '--intent-role', 'clean-reference',
      '--policy', 'restoration-to-reference',
      '--iterations', '1',
    ], { cwd:root, encoding:'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const stalePixel = path.join(output, 'observed-front.png');
    await writeFile(stalePixel, 'prior verified pixel bytes');
    await writeFile(path.join(output, 'capture-route-verification.json'), JSON.stringify({
      status:'verified',
      generation:'0'.repeat(64),
    }));
    child = spawn(process.execPath, [
      path.join(root, 'tools/capture-authored-packing-trajectory-visual.mjs'),
      '--output', output,
      '--base-url', 'http://127.0.0.1:9/fixture/',
    ], {
      cwd:root,
      env:{
        ...process.env,
        NODE_ENV:'test',
        KAMINOS_AUTHORED_CAPTURE_TEST_TRANSITION_PAUSE_MS:'20000',
      },
      stdio:'ignore',
    });
    const closePromise = new Promise(resolve => child.once('close', resolve));
    let batch = null;
    let verification = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      batch = await readFile(path.join(output, 'capture-batch-report.json'), 'utf8')
        .then(JSON.parse).catch(() => null);
      verification = await readFile(path.join(output, 'capture-route-verification.json'), 'utf8')
        .then(JSON.parse).catch(() => null);
      if (batch?.status === 'in-progress' && verification?.status === 'inapplicable') break;
      await delay(10);
    }
    assert.equal(batch?.status, 'in-progress');
    assert.match(batch.batchIdentity.sha256, /^[a-f0-9]{64}$/);
    assert.equal(verification?.status, 'inapplicable');
    assert.equal(verification.captureBatchIdentity.sha256, batch.batchIdentity.sha256);
    assert.equal(await readFile(stalePixel, 'utf8'), 'prior verified pixel bytes');
    child.kill('SIGKILL');
    await closePromise;
    child = null;
    const interruptedBatch = JSON.parse(await readFile(
      path.join(output, 'capture-batch-report.json'),
      'utf8',
    ));
    assert.equal(interruptedBatch.status, 'in-progress');
    const interruptedVerification = JSON.parse(await readFile(
      path.join(output, 'capture-route-verification.json'),
      'utf8',
    ));
    assert.equal(interruptedVerification.status, 'inapplicable');
  } finally {
    child?.kill('SIGKILL');
    await rm(output, { recursive:true, force:true });
  }
});

test('authored current-byte verifier rejects batch-path substitution through its real file-opening route', async t => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const source = path.join(root, 'artifacts/authored-packing-mild-trajectory-v0');
  const verifier = path.join(root, 'tools/verify-current-k4-ring-cage-contact-visual-receipts.mjs');
  const scenarios = [
    {
      name:'missing canonical PNG hidden by redirected stale copy',
      mutate:async (output, batch) => {
        await cp(
          path.join(output, 'observed-front.png'),
          path.join(output, 'foreign-stale-pixels.png'),
        );
        await rm(path.join(output, 'observed-front.png'));
        batch.plannedCaptures[0].outputPath = 'foreign-stale-pixels.png';
        batch.captures[0].outputPath = 'foreign-stale-pixels.png';
      },
    },
    {
      name:'foreign report path while canonical report bytes are consumed',
      mutate:async (_output, batch) => {
        batch.plannedCaptures[0].reportPath = 'foreign-stale-report.json';
        batch.captures[0].reportPath = 'foreign-stale-report.json';
      },
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-path-substitution-'));
      try {
        await cp(source, output, { recursive:true });
        const batchPath = path.join(output, 'capture-batch-report.json');
        const batch = JSON.parse(await readFile(batchPath, 'utf8'));
        await scenario.mutate(output, batch);
        await writeFile(batchPath, `${JSON.stringify(batch, null, 2)}\n`);
        await withStaticFixtureServer(output, async baseUrl => {
          const result = await runChild(process.execPath, [
            verifier,
            '--output', output,
            '--base-url', baseUrl,
          ], { cwd:root, stdio:['ignore', 'pipe', 'pipe'] });
          assert.notEqual(result.status, 0, result.stdout);
          const verification = JSON.parse(await readFile(
            path.join(output, 'capture-route-verification.json'),
            'utf8',
          ));
          assert.equal(verification.status, 'failed');
          assert.match(verification.error, /canonical|ENOENT/i);
        });
      } finally {
        await rm(output, { recursive:true, force:true });
      }
    });
  }
});
