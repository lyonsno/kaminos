import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

for (const [pattern, message] of [
  [/data-crucible-workroom="active"/, 'Main viewport Crucible must be a workroom surface, not only a flat state card'],
  [/id="crucible-worktable-stage"/, 'Crucible workroom must include a stable physical worktable stage for visual smokes'],
  [/id="crucible-viewport-source-plate"/, 'Crucible workroom must keep the source plate as a physical zone'],
  [/id="crucible-viewport-source-thumb"/, 'Crucible workroom must preview the selected source image on the plate'],
  [/id="crucible-viewport-firing-mouth"/, 'Crucible workroom must expose the firing mouth as the live route locus'],
  [/id="crucible-viewport-cast-tray"/, 'Crucible workroom must expose a cast tray for produced assets'],
  [/id="crucible-viewport-shard-rack"/, 'Crucible workroom must expose reusable shard/proxy custody'],
  [/id="crucible-viewport-receipt-tag"/, 'Crucible workroom must expose the last receipt without making it the primary object'],
  [/id="crucible-viewport-proxy-sockets"/, 'Crucible workroom must reserve replaceable sockets for future generated/splat props'],
]) {
  assert.match(index, pattern, message);
}

assert.match(
  index,
  /workspace\.dataset\.crucibleHeatState\s*=/,
  'Crucible workroom must record a heat state so visual witnesses can distinguish idle, firing, cast, and failed route states',
);
assert.match(
  index,
  /sourceThumb\.src\s*=\s*currentSource\.source/,
  'Selected image sources must appear as actual plate thumbnails, not only copied path text',
);
assert.match(
  index,
  /sourceThumb\.hidden\s*=\s*!currentSource\?\.source/,
  'Source thumbnail must fail visibly empty when no source is selected',
);
assert.match(
  index,
  /crucibleViewportHeatState\(/,
  'Heat-state selection must be a named function so route state can evolve without DOM archaeology',
);
assert.match(
  index,
  /crucibleViewportSourcePlateLabel\(/,
  'Source-plate copy must be generated through a named helper instead of scattered path formatting',
);
assert.doesNotMatch(
  index,
  /Root Request|root request|Evidence Bundle|evidence bundle|Graphroot|graphroot/,
  'Crucible workroom must keep internal evidence/request ontology out of operator-facing copy',
);
