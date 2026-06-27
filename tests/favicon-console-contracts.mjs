import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  index,
  /<link\s+rel="icon"\s+href="data:image\/svg\+xml,/,
  'Kaminos declares an inline favicon so browser smokes do not emit /favicon.ico 404 console errors',
);
