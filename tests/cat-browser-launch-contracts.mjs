import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../scene-object-witness.mjs', import.meta.url), 'utf8');
const expression = source.match(/chromeProcess = (spawn\(chrome, \[[\s\S]*?\], \{ stdio: \['ignore', 'ignore', 'pipe'\] \}\));/)[1];
const args = Function('spawn', 'chrome', 'port', 'userDataDir', 'headless', 'url', 'scenario', `return ${expression}`)(
  (_executable, args) => args, '/independent/chrome', 9517, '/owned/profile', false, 'http://localhost/cat', 'cat-retained-playback');
assert.ok(args.includes('--use-mock-keychain'), 'isolated test profile must not request the operator login Keychain');
assert.equal(args.at(-1), 'about:blank', 'cat witness seats one navigation after the CDP connection, not two concurrent navigations');
const guard = source.match(/function assertIndependentHeadlessBrowser\(\) \{([\s\S]*?)\n\}/);
assert.ok(guard, 'launcher must reject the installed GUI Chrome identity before headless execution');
const assertIsolation = (chrome, headless) => Function('chrome', 'headless', guard[1])(chrome, headless);
assert.throws(() => assertIsolation('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', true), /independent browser/);
assert.doesNotThrow(() => assertIsolation('/independent/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', true));
assert.doesNotThrow(() => assertIsolation('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', false));
console.log('cat browser launch contracts passed');
