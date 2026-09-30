import { realpathSync } from 'node:fs';

export function fluidBrowserLaunch({ executable, debugPort, userDataDir, width, height, realpath = realpathSync }) {
  if (!executable) throw new Error('Set KAMINOS_CHROME to an independent Chrome for Testing, Chromium, or headless-shell executable');
  const effectiveExecutable = realpath(executable);
  if (effectiveExecutable.includes('/Applications/Google Chrome.app/')) {
    throw new Error('Fluid capture requires an independent browser; installed operator Chrome is not admitted');
  }
  return {
    executable: effectiveExecutable,
    args: [
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`,
      '--use-mock-keychain', '--password-store=basic',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', `--window-size=${width},${height}`, 'about:blank',
    ],
  };
}
