import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(
  index,
  /kaminos\.generated-motion-path-world-resume-handoff\.v0/,
  'path-world encounters must create an explicit resume-handoff object',
);
assert.match(index, /function createMotionPanelPathWorldResumeHandoff/, 'browser creates episode-owned resume handoffs');
assert.match(index, /function sampleMotionPanelPathWorldResumeHandoff/, 'browser samples resume handoffs during late encounter recovery');
assert.match(index, /pathWorldResumeHandoff/, 'actor/debug evidence exposes path-world resume handoff evidence');
assert.match(index, /handoffPhase/, 'resume handoff evidence reports active handoff phase');
assert.match(index, /handoffTargetProgress/, 'resume handoff records route progress targeted after the obstacle');
assert.match(index, /handoffRoot/, 'resume handoff reports the currently authored handoff root');
assert.match(index, /routeAuthority/, 'path-world runtime exposes root-authority labels');
assert.match(index, /'encounter'/, 'route authority must distinguish encounter-authored motion');
assert.match(index, /'handoff'/, 'route authority must distinguish handoff-authored motion');
assert.match(index, /'world-path'/, 'route authority must distinguish normal world-path motion');
assert.match(index, /handoffStartPoint/, 'resume handoff records where local encounter motion hands off');
assert.match(index, /handoffTargetPoint/, 'resume handoff records where route authority resumes');
assert.match(index, /preEncounterRouteProgress/, 'resume handoff preserves the trigger-time route progress');

assert.match(liveWitness, /pathWorldResumeHandoff/, 'live witness records path-world resume handoff evidence');
assert.match(liveWitness, /handoffPhase/, 'live witness labels expose active handoff phase');
assert.match(liveWitness, /routeAuthority/, 'live witness labels expose active route authority');
