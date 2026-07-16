#!/usr/bin/env node

if (!process.argv.includes('--new-basin-zero-shot')) {
  process.argv.push('--new-basin-zero-shot');
}

await import('./volume-native-low-transfer-long-sequence-witness.mjs');
