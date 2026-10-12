import {mountFluidInvestigation} from '../fluid-investigation.mjs';
import {fluidSourceIdentity} from '../fluid-session-browser.mjs';

// The shared Kit owns capture/finish and file handback. This consumer supplies
// its question and exact starting reflection choice, without changing the water.
export default async function({page,inputs}) {
  if(!inputs.out || !inputs.repo)throw Error('Reflection investigation requires out and repo');
  const source=await fluidSourceIdentity(page.url(),inputs.repo,{additionalFiles:[
    'fluid-reflection-budget.mjs','fluid-reflection-cockpit.mjs','investigation-recording.mjs',
    'investigation-guide.mjs','scene-navigation.mjs',
  ]});
  const initial=await page.evaluate(()=>{
    if(!window.kaminosFluidReflectionComparison)throw Error('Reflection cockpit is not mounted');
    const before=window.kaminosFingerFluidBenchSessionState();
    window.kaminosFluidReflectionComparison.select('A');
    window.kaminosFluidReflectionComparison.configureB({mode:'adaptive',fresnelCutoff:.04});
    const state=window.kaminosFluidReflectionComparison.effective();
    if(state.clock.generation!==before.generation || state.clock.step!==before.step || !state.clock.paused)throw Error('Reflection investigation changed the water');
    return {comparison:window.kaminosFluidReflectionComparison.read(),runtime:state};
  });
  const investigation=await mountFluidInvestigation({page,out:inputs.out,source:{...source,reflectionStart:initial},guide:{
    question:'Which reflection rays change what you can see?',
    tryThis:'Switch A Full and B Candidate on the frozen water. Orbit and zoom around the red block and gold sphere. Try One scene ray, then Skip weak scene reflections. Capture a view when the difference matters.',
    whyThisMatters:'The full footprint uses five scene reflection queries. Single uses one. Weak reflection skipping uses environment light below the chosen Fresnel cutoff, retaining full scene queries at grazing angles. Compare their visible benefit before choosing the cheaper rendering.',
    ...inputs.guide,
  }});
  return investigation.finished;
}
