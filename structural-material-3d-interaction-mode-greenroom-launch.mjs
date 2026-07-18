#!/usr/bin/env node

process.env.RESIDENT_SOLVER_ARTIFACT_TAG ||= 'bind-interaction-mode-greenroom-r3';
process.env.RESIDENT_SOLVER_DEBUG_PORT ||= '19497';

await import('./structural-material-3d-resident-solver-greenroom-launch.mjs');
