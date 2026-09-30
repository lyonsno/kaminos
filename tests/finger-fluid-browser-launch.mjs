import assert from 'node:assert/strict';
import { fluidBrowserLaunch } from '../finger-fluid-browser-launch.mjs';

const input = { executable: '/isolated/Chrome for Testing', debugPort: 19302,
  userDataDir: '/isolated/profile', width: 1440, height: 900,
  realpath: path => path };
const launch = fluidBrowserLaunch(input);
assert.ok(launch.args.includes('--use-mock-keychain'), 'disposable capture must avoid real macOS Keychain access');
assert.ok(launch.args.includes('--password-store=basic'), 'automation uses a profile-local password store');
assert.equal(launch.executable, input.executable);
assert.ok(launch.args.includes('--remote-debugging-port=19302'));
assert.ok(launch.args.includes('--user-data-dir=/isolated/profile'));
assert.throws(() => fluidBrowserLaunch({ ...input, executable: undefined }), /KAMINOS_CHROME/, 'missing independent browser fails before launch');
assert.throws(() => fluidBrowserLaunch({ ...input, executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), /independent/, 'operator Chrome cannot become the test browser');
assert.throws(() => fluidBrowserLaunch({ ...input, realpath: () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), /independent/, 'symlink cannot hide operator Chrome');
assert.throws(() => fluidBrowserLaunch({ ...input, realpath: () => { throw new Error('ENOENT'); } }), /ENOENT/, 'missing executable fails before spawn');
console.log('Fluid browser launcher policy passed');
