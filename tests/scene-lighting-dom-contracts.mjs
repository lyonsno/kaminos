import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
assert.ok(process.argv[2], 'provide an installed Playwright module path');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const source = readFileSync(new URL('../index.html', import.meta.url),'utf8');
const start = source.indexOf('// --- Authored Rim Light ---');
const code = source.slice(start, source.indexOf('// --- Exposure / Intensity Controls ---',start));
const markup = source.slice(source.indexOf('<h2>Rim Light</h2>'),source.indexOf('<h2>Post Processing</h2>'));
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu','--disable-software-rasterizer']});
try {
  const page = await browser.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent(markup+'<script>let rimLight=null;function saveSettings(){};'+code+'\nsetRimLight();</script>');
  await page.locator('#rim-enabled').check();
  await page.locator('#rim-intensity-number').fill('123.45');
  await page.locator('#rim-intensity-number').dispatchEvent('change');
  assert.equal(await page.locator('#rim-intensity').inputValue(),'123.45','numeric intensity must not reject fine tuning');
  const recipe={enabled:true,color:'#abcdef',intensity:501.25,azimuth:237.12,elevation:13.123,distance:5.4567,angle:23.45,penumbra:0.5678,target:[1.2345,-2.3456,3.4567]};
  await page.evaluate(recipe=>setRimLight(recipe),recipe);
  for(const [key,value] of Object.entries({...recipe,'target-x':recipe.target[0],'target-y':recipe.target[1],'target-z':recipe.target[2]})){
    if(typeof value!=='number')continue;
    assert.equal(Number(await page.locator(`#rim-${key}`).inputValue()),value);
    assert.equal(Number(await page.locator(`#rim-${key}-number`).inputValue()),value);
    await page.locator(`#rim-${key}-number`).dispatchEvent('change');
    assert.equal(Number(await page.locator(`#rim-${key}`).inputValue()),value);
  }
  await page.locator('#rim-enabled').uncheck();await page.locator('#rim-enabled').check();
  assert.deepEqual(await page.evaluate(()=>readRimLightSettings()),recipe);
  await page.locator('#rim-distance-number').fill('-1');await page.locator('#rim-distance-number').dispatchEvent('change');
  assert.equal(Number(await page.locator('#rim-distance').inputValue()),recipe.distance);
  assert.deepEqual(errors,[]);
  console.log('lighting paired-input DOM contracts passed');
} finally {await browser.close();}
