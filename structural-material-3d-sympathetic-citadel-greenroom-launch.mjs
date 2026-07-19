#!/usr/bin/env node

process.env.RESIDENT_SOLVER_ARTIFACT_TAG ||= 'sympathetic-citadel-greenroom-r1';
process.env.RESIDENT_SOLVER_DEBUG_PORT ||= '19499';
process.env.RESIDENT_SOLVER_URL ||=
  'http://127.0.0.1:8395/structural-material-3d.html?sympatheticCitadel=1&hapticCompanion=off';

await import('./structural-material-3d-resident-solver-greenroom-launch.mjs');
