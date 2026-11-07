export function assertMicrostructureServer(expected,actual){
  if(!actual||actual.repoRoot!==expected.repoRoot||actual.commit!==expected.commit||actual.branch!==expected.branch||actual.dirty!==false)throw Error('Effective renderer source differs from the expected clean checkout/revision');
  return actual;
}
