import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const {values: args} = parseArgs({options: Object.fromEntries(
  ['url','output','browser','playwright'].map(key => [key, {type:'string'}]))});
assert(args.output, '--output required');
const out = resolve(args.output); mkdirSync(out, {recursive:true});
const report = {status:'failed', phase:'setup', url:args.url, browser:args.browser, errors:[]};
const save = () => writeFileSync(out+'/report.json', JSON.stringify(report,null,2));
save(); let browser;
try {
  const {chromium} = await import(pathToFileURL(resolve(args.playwright)));
  browser = await chromium.launchPersistentContext(out+'/profile', {headless:true,
    executablePath:args.browser, viewport:{width:1600,height:1000}, deviceScaleFactor:1,
    args:['--use-mock-keychain','--password-store=basic']});
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  report.phase='open'; save();
  await page.goto(args.url);
  await page.waitForFunction(() => window.kaminosWorkbenchExperiments?.state().id === 'hand-comparison');
  const invoke = (name,input) => page.evaluate(({name,input}) => window.kaminosWorkbenchExperiments.invoke(name,input), {name,input});
  const read = () => page.evaluate(() => window.kaminosWorkbenchExperiments.read());
  report.initial = await read(); assert.equal(report.initial.index,0);
  assert.equal(report.initial.authority,'recorded_diagnostic_not_live');
  assert.equal(report.initial.frameCount,206);
  report.phase='controls'; save();
  await page.getByRole('slider',{name:'Recorded capture'}).fill('103');
  await page.waitForFunction(() => document.querySelector('[data-hand-comparison-status]')?.textContent.includes('104/206'));
  report.selected = await read();
  assert.equal(report.selected.captureOffsetMs,19053);
  await page.getByRole('button',{name:'Frame comparison',exact:true}).click();
  await page.screenshot({path:out+'/desktop.png'});
  const canvas = page.locator('#kaminos-host-renderer-canvas');
  const first = await canvas.screenshot();
  report.pixelColors = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const canvas = document.createElement('canvas'); canvas.width=bitmap.width; canvas.height=bitmap.height;
    const c=canvas.getContext('2d');c.drawImage(bitmap,0,0);
    const pixels=c.getImageData(0,0,canvas.width,canvas.height).data, colors=new Set();
    for(let i=0;i<pixels.length;i+=4)colors.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);
    return colors.size;
  }, [...first]);
  assert(report.pixelColors > 100,'blank_comparison');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-hand-comparison-status]')?.textContent.match(/Recorded \| (\d+)\//)?.[1]) > 106);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  assert.notDeepEqual(await canvas.screenshot(),first,'playback_did_not_change_pixels');
  report.played = await read();
  await invoke('seek',188);
  await page.screenshot({path:out+'/pointing.png'});
  await page.setViewportSize({width:430,height:932});
  await invoke('frame');
  await page.screenshot({path:out+'/mobile.png'});
  report.mobile = await read();
  assert.equal(report.mobile.view.position[2],9.8,'narrow_view_not_framed');
  report.phase='missing_image'; save();
  await page.setViewportSize({width:1600,height:1000});
  await page.route('**/frames/0189.png', route => route.fulfill({status:404,body:'missing diagnostic frame'}));
  const missingResponse = page.waitForResponse(response => response.url().endsWith('/frames/0189.png'));
  await page.getByRole('slider',{name:'Recorded capture'}).fill('189');
  await missingResponse;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const failed = await read();
  assert(failed.error?.includes('unavailable'));
  assert.equal(failed.playing,false);
  assert.equal(failed.visible,false);
  report.visibleFailure = await page.locator('[data-hand-comparison-status]').textContent();
  assert.match(report.visibleFailure,/Capture 190 unavailable/,'slider_erased_visible_error');
  await page.screenshot({path:out+'/missing-image.png'});
  report.missingImage = failed;
  await page.unroute('**/frames/0189.png');
  await invoke('seek',189);
  assert.equal((await read()).error,null);
  report.phase='reopen'; save();
  await page.evaluate(() => window.kaminosWorkbenchExperiments.close());
  await page.goto(args.url);
  await page.waitForFunction(() => window.kaminosWorkbenchExperiments?.state().id === 'hand-comparison');
  assert.equal((await read()).index,0);
  report.reopened=await read();
  assert.deepEqual(report.errors,[]);
  report.status='passed'; report.phase=null;
} catch(error) {
  report.error=String(error); process.exitCode=1;
} finally {
  await browser?.close(); report.browserClosed=true; save();
}
