import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  index,
  /id="sharp-breathing-room-default-button"/,
  'Generate panel must expose a dedicated default SHARP route button',
);
assert.match(
  index,
  /id="sharp-breathing-room-friendly-button"/,
  'Generate panel must expose a dedicated friendly SHARP route button',
);
assert.match(
  index,
  />Run default</,
  'Default route button must use operator-facing copy instead of an internal profile id',
);
assert.match(
  index,
  />Run friendly</,
  'Friendly route button must use operator-facing copy instead of an internal profile id',
);
assert.doesNotMatch(
  index,
  /<button[^>]*>(?:(?!<\/button>).)*cooperative-spn-gaussian(?:(?!<\/button>).)*<\/button>/s,
  'Internal cooperative profile id must not be visible as button copy',
);
assert.match(
  index,
  /function runSharpBreathingRoomProfile\(/,
  'Generate panel buttons must call a live profile runner rather than acting as static diagnostics',
);
assert.match(
  index,
  /schedulerProfileId:\s*profileId/,
  'Live profile runner must send the selected scheduler profile id to the server',
);
assert.match(
  index,
  /runSharpBreathingRoomProfile\('baseline-default'\)/,
  'Default button must actuate the baseline-default profile',
);
assert.match(
  index,
  /runSharpBreathingRoomProfile\('cooperative-spn-gaussian'\)/,
  'Friendly button must actuate the cooperative profile',
);
assert.match(
  index,
  /sharp-breathing-room-status/,
  'Generate panel must show the route status beside the two buttons',
);
assert.match(
  index,
  /function pipelineRunFailureSummary\(/,
  'Generate panel failures must extract backend report details instead of showing only generic failure copy',
);
assert.match(
  index,
  /stderrTail/,
  'Failure summary must inspect adapter stderr when the run fails before output',
);
assert.match(
  index,
  /adapterReport\?\.phase/,
  'Failure summary must expose adapter report phase when available',
);
