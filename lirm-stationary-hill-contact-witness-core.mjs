export const EXPECTED_STATIONARY_CONTACT_ROUTE = 'kaminos/lirm-719024/published-stationary-contact-v0';
export const EXPECTED_STATIONARY_CONTACT_INNER_ROUTE = 'kaminos/fitted-proxy-rig/appendage-local-carrier-contact-v1';
export const EXPECTED_STATIONARY_CONTACT_AUTHORITY = 'appendage-local-rigid-carriers-plus-bounded-rigid-body-fit';
export const EXPECTED_STATIONARY_CONTACT_SOURCE_HASH = '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e';
export const EXPECTED_STATIONARY_CONTACT_RECEIPT = 'sha256:4feca6a1d50cb1387b520e5375b75bb42db882279bf260cfc1ac7c12bbb823ad';
export const EXPECTED_STATIONARY_CONTACT_CONSTRAINTS = 'sha256:8fea248f4c275f8db4d687d57aea17db9e5f91192bbef39c89665fc9c2b23029';
export const EXPECTED_STATIONARY_CONTACT_HILL = Object.freeze({
  id: 'hill-of-hills-motion-affordance-packet-v0',
  sourceRef: 'lerms:cc/hill-of-hills-live-terrain-server-0702@81c5348',
  revision: '81c5348',
});
export const EXPECTED_STATIONARY_CONTACT_INPUT_HASHES = Object.freeze({
  registration: 'sha256:a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9',
  contactAtlas: 'sha256:e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
  phaseReport: 'sha256:97abeb1cdacb802ecf26e2aba6e27ae9d96508e6f85836853b9c3bdd993583ff',
  handshake: 'sha256:f6d5d91f71dd34feb5c632ca0c673cb82877a011e63d3e2348c851b2c5649112',
  axialRegistration: 'sha256:cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
  hillPacket: 'sha256:ab9900438d60ca3356327e700617c65fd65e75e4b2707d8e03da0e2f3dd8e9e2',
  hillData: 'sha256:bd29f0464aecffdd35d79496b744b6d04175b1c2b8a80934fa3c88ed34874fd7',
});
export const EXPECTED_STATIONARY_CONTACT_MAXIMUM_RESIDUAL = 0.06;

export function assertStationaryHillContactWitnessState(state) {
  if (state?.status !== 'loaded' || state.happy !== true) {
    throw new Error('viewer did not declare happy loaded state');
  }
  if (state.requestedRoute !== EXPECTED_STATIONARY_CONTACT_ROUTE
      || state.effectiveRoute !== EXPECTED_STATIONARY_CONTACT_ROUTE) {
    throw new Error(`effective route mismatch: ${state.effectiveRoute}`);
  }
  if (state.sourceHash !== EXPECTED_STATIONARY_CONTACT_SOURCE_HASH
      || state.actualSourceHash !== EXPECTED_STATIONARY_CONTACT_SOURCE_HASH) {
    throw new Error('source identity mismatch');
  }
  if (state.supportSurface?.id !== EXPECTED_STATIONARY_CONTACT_HILL.id
      || state.supportSurface?.sourceRef !== EXPECTED_STATIONARY_CONTACT_HILL.sourceRef
      || state.supportSurface?.revision !== EXPECTED_STATIONARY_CONTACT_HILL.revision) {
    throw new Error('Hill support identity mismatch');
  }
  if (Object.entries(EXPECTED_STATIONARY_CONTACT_INPUT_HASHES).some(
    ([name, expected]) => state.inputHashes?.[name] !== expected,
  )) {
    throw new Error('load-bearing input hash identity mismatch');
  }
  if (state.publication?.receiptSha256 !== EXPECTED_STATIONARY_CONTACT_RECEIPT) {
    throw new Error('reviewed receipt identity mismatch');
  }
  if (state.publication?.constraintsSha256 !== EXPECTED_STATIONARY_CONTACT_CONSTRAINTS
      || state.publication?.constraintsId !== 'stationary-hill-probes:C:constraints') {
    throw new Error('published constraint identity mismatch');
  }
  if (state.directVertexTranslationCount !== 0) {
    throw new Error('direct vertex translations entered the route');
  }
  if (state.contactRoute !== EXPECTED_STATIONARY_CONTACT_INNER_ROUTE
      || state.contactAuthority !== EXPECTED_STATIONARY_CONTACT_AUTHORITY
      || state.carrierTransformCount !== 4) {
    throw new Error('appendage-local carrier route identity mismatch');
  }
  if (!Number.isFinite(state.maximumResidual)) throw new Error('contact residual is not finite');
  if (state.maximumResidual > EXPECTED_STATIONARY_CONTACT_MAXIMUM_RESIDUAL) {
    throw new Error(
      `contact residual ceiling exceeded: ${state.maximumResidual}`
        + ` > ${EXPECTED_STATIONARY_CONTACT_MAXIMUM_RESIDUAL}`,
    );
  }
  if (!Number.isFinite(state.solveMilliseconds)) {
    throw new Error('contact solve duration is not finite');
  }
  return state;
}

export function createStationaryHillContactWitnessIdentity(state) {
  assertStationaryHillContactWitnessState(state);
  return {
    requestedRoute: state.requestedRoute,
    effectiveRoute: state.effectiveRoute,
    sourceHash: state.sourceHash,
    actualSourceHash: state.actualSourceHash,
    hillId: state.supportSurface.id,
    hillSourceRef: state.supportSurface.sourceRef,
    hillRevision: state.supportSurface.revision,
    inputHashes: { ...state.inputHashes },
    receiptSha256: state.publication.receiptSha256,
    constraintsSha256: state.publication.constraintsSha256,
    constraintsId: state.publication.constraintsId,
    directVertexTranslationCount: state.directVertexTranslationCount,
    contactRoute: state.contactRoute,
    contactAuthority: state.contactAuthority,
    carrierTransformCount: state.carrierTransformCount,
  };
}
