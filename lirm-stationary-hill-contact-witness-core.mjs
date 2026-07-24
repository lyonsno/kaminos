export const EXPECTED_STATIONARY_CONTACT_ROUTE = 'kaminos/lirm-719024/published-stationary-contact-v0';
export const EXPECTED_STATIONARY_CONTACT_SOURCE_HASH = '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e';
export const EXPECTED_STATIONARY_CONTACT_RECEIPT = 'sha256:4feca6a1d50cb1387b520e5375b75bb42db882279bf260cfc1ac7c12bbb823ad';
export const EXPECTED_STATIONARY_CONTACT_CONSTRAINTS = 'sha256:8fea248f4c275f8db4d687d57aea17db9e5f91192bbef39c89665fc9c2b23029';

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
  if (state.supportSurface?.revision !== '81c5348') throw new Error('Hill revision mismatch');
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
  if (!Number.isFinite(state.maximumResidual)) throw new Error('contact residual is not finite');
  if (!Number.isFinite(state.solveMilliseconds)) {
    throw new Error('contact solve duration is not finite');
  }
  return state;
}
