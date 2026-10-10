import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readObservationSession} from '../observation-session.mjs';
import {mountFluidInvestigation} from '../fluid-investigation.mjs';
import {fluidSourceIdentity} from '../fluid-session-browser.mjs';

// Native interaction exercise, run by tools/fluid-session-run.mjs. The source
// owner hooks must be composed before this can pass the operation assertions.
export default async function ({page, fluid, inputs}) {
  await fluid.advanceTo((await fluid.read()).clock.step + 30);
  const source = await fluidSourceIdentity(page.url(), inputs.repo, {
    additionalFiles: ['investigation-recording.mjs', 'investigation-guide.mjs', 'scene-navigation.mjs'],
  });
  const mounted = await mountFluidInvestigation({page, out: inputs.out, source, guide: {
    question: 'What changes about the water edge from another view?',
    tryThis: 'Change cohesion and look behind the edge.',
    whyThisMatters: 'Different views and settings may change our interpretation of the same water.',
  }});
  const guide = page.locator('.investigation-guide');
  await guide.getByLabel('Your observation').fill('Automated mechanics exercise: inspect this edge from another view.');
  await guide.getByText('Try This', {exact: true}).click();
  await page.locator('#ipbf-cohesion').focus();
  await page.locator('#ipbf-cohesion').press('ArrowLeft');
  await page.locator('#ipbf-cohesion').press('ArrowRight');
  const viewport = await page.evaluate(() => ({width: innerWidth, height: innerHeight}));
  await page.mouse.move(viewport.width * .58, viewport.height * .45);
  await page.mouse.down({button: 'middle'});
  await page.mouse.move(viewport.width * .68, viewport.height * .5, {steps: 6});
  await page.mouse.up({button: 'middle'});
  await guide.getByRole('button', {name: 'Capture', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('.investigation-guide output')?.textContent !== 'Recording');
  const status = await guide.locator('output').textContent();
  assert.equal(status, 'Capture retained');
  const index = JSON.parse(await fs.readFile(mounted.reportPath));
  const capture = await readObservationSession(path.join(index.captures[0].out, 'report.json'));
  await guide.getByRole('button', {name: 'Finish', exact: true}).click();
  await mounted.finished;
  const operations = capture.result.after.recording.operations;
  assert.ok(operations.filter(o => o.kind === 'fluid.controls').length >= 2,
    'actual intermediate cockpit input must reach recording');
  assert.ok(operations.some(o => o.kind === 'camera.pose'), 'actual navigation must reach recording');
  return {report: mounted.reportPath, captures: index.captures, operationCount: operations.length,
    claim: 'automated native input/capture mechanics; operator detour remains a human exercise'};
}
