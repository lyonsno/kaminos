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
  /function crucibleViewportRoomPosture\(\{ heatState, routeStatus \}\)/,
  'Room posture must be derived through a named helper instead of incidental CSS state',
);
assert.match(
  index,
  /workspace\.dataset\.crucibleRoomPosture\s*=\s*roomPosture/,
  'The workroom must expose its effective spatial posture to visual witnesses',
);
assert.match(
  index,
  /data-crucible-room-posture="bench"/,
  'The workroom must declare its initial full-bench posture without waiting for route activity',
);
assert.match(
  index,
  /data-crucible-console-state="expanded"/,
  'The workroom must declare presentation state separately from route posture',
);
assert.match(
  index,
  /function crucibleViewportConsoleState\(roomPosture\)/,
  'Console presentation must be derived through a named helper instead of rewriting route truth',
);
assert.match(
  index,
  /workspace\.dataset\.crucibleConsoleState\s*=\s*consoleState/,
  'The workroom must expose whether the operator is seeing the full bench or tucked caddy',
);

for (const [pattern, message] of [
  [/#crucible-viewport-workspace\[data-crucible-room-posture="firing"\][\s\S]*?pointer-events:\s*none;/, 'The firing posture must open the unused viewport to the live furnace instead of retaining a full-screen input shield'],
  [/#crucible-viewport-workspace\[data-crucible-room-posture="cast-held"\][\s\S]*?pointer-events:\s*none;/, 'The completed posture must open the unused viewport to the loaded cast'],
  [/#crucible-viewport-workspace\[data-crucible-room-posture="cast-held"\]\[data-crucible-console-state="tucked"\][^}]*padding:\s*58px 14px 14px;/, 'The completed caddy must clear the scene transform toolbar instead of hiding its own title'],
  [/data-crucible-console-state="tucked"\][\s\S]*?\.crucible-workroom-shell[\s\S]*?width:\s*min\(340px,\s*calc\(100% - 28px\)\)/, 'An active firing or completed cast must become a genuinely narrow kiln caddy'],
  [/data-crucible-console-state="tucked"\][\s\S]*?\.crucible-workroom-shell[\s\S]*?pointer-events:\s*auto;/, 'The tucked kiln caddy must remain directly operable'],
  [/data-crucible-room-posture="firing"\][\s\S]*?\.crucible-viewport-proxy-sockets[\s\S]*?display:\s*none;/, 'Ancillary proxy sockets must leave the live furnace visual field during firing'],
  [/data-crucible-room-posture="cast-held"\][\s\S]*?\.crucible-viewport-shard-rack[\s\S]*?display:\s*none;/, 'The empty shard rack must not crowd the completed cast posture'],
]) {
  assert.match(index, pattern, message);
}
assert.match(
  index,
  /<details[^>]+id="crucible-viewport-receipt-tag"[^>]*>[\s\S]*?<summary[^>]*>Last firing<\/summary>/,
  'Technical firing receipts must be expandable subtext instead of permanent primary UI',
);
assert.match(
  index,
  /#sidebar\.crucible-sidebar-released\s*\{[^}]*width:\s*0;/,
  'The tucked caddy must release the legacy sidebar width back to the cast workspace',
);
assert.match(
  index,
  /function syncCrucibleViewportChrome\(workspace[\s\S]*workspace && !workspace\.hidden[\s\S]*document\.body\.dataset\.crucibleConsoleState[\s\S]*classList\.toggle\('crucible-sidebar-released', consoleState === 'tucked'\)/,
  'Sidebar release must follow the visible Crucible rather than leaking into other app tabs',
);

for (const id of [
  'crucible-viewport-source-plate',
  'crucible-viewport-firing-mouth',
  'crucible-viewport-cast-tray',
  'crucible-viewport-receipt-tag',
]) {
  assert.doesNotMatch(
    index,
    new RegExp(`data-crucible-room-posture="(?:firing|cast-held)"[^}]*#${id}[^}]*display:\\s*none`, 's'),
    `${id} must remain accessible in compact workroom postures`,
  );
}
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
