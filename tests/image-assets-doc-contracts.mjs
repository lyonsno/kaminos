import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const docs = readFileSync(join(root, 'docs/image-assets.md'), 'utf8');

assert.match(docs, /image-inbox/, 'Image asset docs name the experimental image inbox root');
assert.match(docs, /image-production/, 'Image asset docs name the production image root');
assert.match(docs, /KAMINOS_IMAGE_INBOX_DIR/, 'Image asset docs name the image inbox environment override');
assert.match(docs, /KAMINOS_IMAGE_PRODUCTION_DIR/, 'Image asset docs name the production image environment override');
assert.match(docs, /KAMINOS_IMAGE_ASSET_ROOTS/, 'Image asset docs name additional image roots');
assert.match(docs, /\/api\/assets\?kind=image/, 'Image asset docs expose the machine-readable image index');
assert.match(docs, /\/api\/ingest-image/, 'Image asset docs expose the image ingest route');
assert.match(docs, /Evil Orb/i, 'Image asset docs give an Evil Orb test-image naming/location example');
