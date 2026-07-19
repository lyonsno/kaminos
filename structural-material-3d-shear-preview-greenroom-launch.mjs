#!/usr/bin/env node

process.env.RESIDENT_SOLVER_ARTIFACT_TAG ||= 'continuous-shear-preview-greenroom-r5';
process.env.RESIDENT_SOLVER_DEBUG_PORT ||= '19498';

await import('./structural-material-3d-resident-solver-greenroom-launch.mjs');
