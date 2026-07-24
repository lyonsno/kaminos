import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../crucible-viewport-witness.mjs', import.meta.url), 'utf8');
const selection = readFileSync(
  new URL('../kiln-sharp-fire-actor-selection.json', import.meta.url),
  'utf8',
);

assert.match(
  page,
  /createKilnPromotedFireActorApplication/,
  'the proved SHARP host must mount the promoted FireActor composition',
);
assert.match(
  selection,
  /"basinRevision": "basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95"/,
  'the product host must bind the exact promoted Flamebowl actor revision',
);
assert.match(
  page,
  /decoderKernelAdjustmentGain:\s*0\.375/,
  'the FireActor composition must preserve Wake SHARP adaptive gain 0.375',
);
assert.match(
  witness,
  /resolveHeadlessBrowser/,
  'the combined witness must retain Wake browser resolution',
);
assert.match(
  witness,
  /--remote-debugging-port=0/,
  'the combined witness must let its browser child allocate the CDP port',
);
assert.match(
  witness,
  /DevToolsActivePort/,
  'the combined witness must discover the child-owned CDP session',
);
assert.match(
  witness,
  /fireActorProductEpisode[\s\S]{0,1600}mountId[\s\S]{0,400}actorId[\s\S]{0,400}basinRevision[\s\S]{0,400}packageSha256/,
  'the combined witness must fail loud on exact effective FireActor identity',
);
assert.match(
  page,
  /waitForWakeSharpPromotedFirePresentation[\s\S]*createForegroundKilnHeartbeatEpisode/,
  'the combined host must prove a rendered promoted frame before foreground verification',
);
assert.match(
  page,
  /waitForWakeSharpPromotedFirePresentation\(\{[\s\S]{0,300}timeoutMs = null[\s\S]{0,1200}callerDeadlineMs = timeoutMs === null \? null/,
  'promoted readiness must remain uncapped unless its caller supplies a deadline',
);
