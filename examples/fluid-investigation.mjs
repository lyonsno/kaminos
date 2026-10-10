import {mountFluidInvestigation} from '../fluid-investigation.mjs';
import {fluidSourceIdentity} from '../fluid-session-browser.mjs';

export default async function ({page, inputs}) {
  if (!inputs.out || !inputs.repo) throw Error('Investigation inputs require out and repo');
  const source = await fluidSourceIdentity(page.url(), inputs.repo, {
    additionalFiles: ['investigation-recording.mjs', 'investigation-guide.mjs', 'scene-navigation.mjs'],
  });
  const investigation = await mountFluidInvestigation({page, out: inputs.out, source, guide: {
    question: 'What changes about the beaded edge from another view?',
    tryThis: 'Look behind the edge, then advance the water briefly.',
    whyThisMatters: 'The second view and later state help distinguish a persistent structure from a view-dependent appearance.',
    ...inputs.guide,
  }});
  return investigation.finished;
}
