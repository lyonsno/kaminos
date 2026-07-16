#!/usr/bin/env node

for (const flag of ['--new-basin-zero-shot', '--latest-basin-trained-comparison']) {
  if (!process.argv.includes(flag)) process.argv.push(flag);
}

await import('./volume-native-low-transfer-long-sequence-witness.mjs');
