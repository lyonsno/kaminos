#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const driver = fileURLToPath(new URL('./sam31-two-frame-tracker-browser-parity-smoke.mjs', import.meta.url));
const child = spawn(process.execPath, [driver, '--episode-mode', 'two-image', ...process.argv.slice(2)], { stdio: 'inherit' });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`two-image tracker witness terminated by ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
