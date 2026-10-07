import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// A saved basin loads with the values it was saved with. A slider whose range
// or step cannot hold a saved value widens to hold it (and says so) instead of
// clamping or rounding; a select takes any option it offers.
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const grab = head => index.match(new RegExp(`${head.replace(/[()]/g, '\\$&')}[^]*?\\n\\}`))?.[0];
const setterSource = grab('function applyVolumeRangeValueExactly(');
assert.ok(setterSource, 'an exact range setter exists');

const widenings = [];
const context = vm.createContext({ window: { __kaminosVolumeControlRangeWidenings: widenings }, Number, String, Math });
vm.runInContext(`${setterSource}; this.applyVolumeRangeValueExactly = applyVolumeRangeValueExactly;`, context);
const range = (min, max, step, value) => ({ id: 'slider', type: 'range', min, max, step, value });

const yellow = range('0', '0.4', 'any', '0.28');
context.applyVolumeRangeValueExactly(yellow, 0.86);
assert.deepEqual([yellow.min, yellow.max, yellow.value], ['0', '0.86', '0.86'], 'a saved value above the range widens max');
const low = range('0.05', '2', 'any', '1');
context.applyVolumeRangeValueExactly(low, 0.01);
assert.deepEqual([low.min, low.value], ['0.01', '0.01'], 'a saved value below the range widens min');
const stepped = range('0', '1', '0.02', '0.5');
context.applyVolumeRangeValueExactly(stepped, 0.7727);
assert.deepEqual([stepped.step, stepped.value], ['any', '0.7727'], 'an off-grid saved value keeps its precision');
const onGrid = range('0', '1', '0.02', '0.5');
context.applyVolumeRangeValueExactly(onGrid, 0.64);
assert.deepEqual([onGrid.min, onGrid.max, onGrid.step, onGrid.value], ['0', '1', '0.02', '0.64'], 'an in-range on-grid value changes nothing else');
assert.deepEqual(JSON.parse(JSON.stringify(widenings)), [
  { id: 'slider', value: 0.86, min: '0', max: '0.4', step: 'any', widened: ['max'] },
  { id: 'slider', value: 0.01, min: '0.05', max: '2', step: 'any', widened: ['min'] },
  { id: 'slider', value: 0.7727, min: '0', max: '1', step: '0.02', widened: ['step'] },
], 'every widening is recorded with what the control held before');

// The route loader uses the exact setter instead of clamping or rounding.
const routeInit = index.slice(index.indexOf('async function initKaminosVolumeRoute('));
const fieldLoop = routeInit.slice(routeInit.indexOf('for (const field of REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS)'));
assert.match(fieldLoop.slice(0, 400), /applyVolumeRangeValueExactly\(document\.getElementById\(field\.id\), routeValue\)/,
  'route values for the reaction control table load exactly');
assert.doesNotMatch(fieldLoop.slice(0, 400), /clampVolumeControlValue/, 'the route loader no longer clamps saved values');
const shellLoop = routeInit.slice(routeInit.indexOf("['volume_shell_amount', 'volume-shell-amount'"));
assert.match(shellLoop.slice(0, 1500), /applyVolumeRangeValueExactly\(document\.getElementById\(id\), routed\)/,
  'shell route values load exactly');
// Route selects take any option the page offers.
const shellInspect = routeInit.slice(routeInit.indexOf('const routeShellInspectMode'), routeInit.indexOf('const routeShellInspectMode') + 600);
assert.match(shellInspect, /volumeSelectOffers\(document\.getElementById\('volume-shell-inspect-mode'\), routeShellInspectMode\)/,
  'shell inspect accepts every mode the select offers, including boundary_fire');
const offersSource = grab('function volumeSelectOffers(');
assert.ok(offersSource);
const offers = vm.runInNewContext(`${offersSource}; volumeSelectOffers`, {});
assert.equal(offers({ options: [{ value: 'shell' }, { value: 'boundary_fire' }] }, 'boundary_fire'), true);
assert.equal(offers({ options: [{ value: 'shell' }] }, 'boundary_fire'), false);
console.log('volume exact load contracts passed');
