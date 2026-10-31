export function waitForLermScene(page) {
  return page.waitForFunction(() => {
    if (window.kaminosWorkbenchExperimentError) throw Error(window.kaminosWorkbenchExperimentError);
    const state = window.kaminosWorkbenchExperiments?.state();
    if (document.body.innerText.includes('Experiments unavailable')) throw Error(document.body.innerText);
    return state?.id === 'lerms/hand-goin';
  }, undefined, {timeout: 0});
}
