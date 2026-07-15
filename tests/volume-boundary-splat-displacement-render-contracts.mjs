#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const exporter = await readFile(new URL('../volume-full-grid-field-export.mjs', import.meta.url), 'utf8');

assert.match(core, /BOUNDARY_SPLAT_DISPLACEMENT_CUE_AUTHORITY\s*=\s*'validation-selected-vacancy-gated-offset-class-grid-v0'/, 'runtime names the displacement cue authority');
assert.match(core, /BOUNDARY_SPLAT_DISPLACEMENT_APPLICATION_IDENTITY\s*=\s*'render-only-vacancy-gated-one-cell-splat-displacement-v0'/, 'runtime names the displacement application');
assert.match(core, /function scalarActivityCueChannelOrderForAuthority\(cueAuthority\)[\s\S]*cueAuthority\s*===\s*BOUNDARY_SPLAT_DISPLACEMENT_CUE_AUTHORITY[\s\S]*\['boundarySplatOffsetClassNormalized'\][\s\S]*\['fireFlowVisibilityCarrier'\]/, 'scalar transport resolves an exact channel order from the admitted cue authority');
assert.match(core, /const expectedChannelOrder\s*=\s*scalarActivityCueChannelOrderForAuthority\(cueAuthority\)[\s\S]*JSON\.stringify\(payload\.channelOrder\)\s*!==\s*JSON\.stringify\(expectedChannelOrder\)/, 'browser import validates the payload against its authority-specific channel order');
assert.match(core, /splatDisplacementEnabled:\s*clampFinite\(snapshot\.oracleActivitySplatDisplacement,\s*0,\s*1,\s*0\)/, 'displacement is explicit, bounded, and inert by default');
assert.match(core, /activityControls:\s*vec4<f32>/, 'existing splat controls carry the displacement mode without a new full-grid copy');
assert.match(core, /fn boundarySplatDecodedOffset[\s\S]*scalarActivityCue\[boundarySplatCellIndex\(cell\)\][\s\S]*26\.0[\s\S]*vec3<i32>/, 'compute pass decodes one of 27 bounded offset classes from the uploaded scalar grid');
assert.match(core, /let displacedWorld\s*=\s*world\s*\+\s*vec3<f32>\(boundarySplatDecodedOffset\(gid\)\)\s*\*\s*cellWidth/, 'displacement changes only the candidate center by integer cell widths');
assert.match(core, /positionSupport\s*=\s*vec4<f32>\(displacedWorld,\s*structuralSignal\)/, 'compaction publishes the displaced center while retaining support');
assert.match(core, /oracleActivitySplatDisplacementRequested[\s\S]*oracleActivitySplatDisplacementEffective[\s\S]*render-only-vacancy-gated-one-cell-splat-displacement-v0/, 'frozen render receipt preserves requested/effective displacement custody');

assert.match(exporter, /--boundary-splat-displacement-manifest/, 'exporter accepts a dedicated displacement manifest');
assert.match(exporter, /kaminos\.volume\.boundary-splat-displacement-probe\.v0/, 'exporter admits only the displacement probe schema');
assert.match(exporter, /boundarySplatOffsetClassNormalized/, 'exporter requires the exact normalized offset channel');
assert.match(exporter, /validation-selected-vacancy-gated-offset-class-grid-v0/, 'exporter requires the gated displacement authority');
assert.match(exporter, /boundary-splat-displacement-gain-mismatch/, 'exporter fails loud when requested displacement is not effective');
assert.match(exporter, /boundary splat displacement assay requires --render-only, --initial-field-manifest, and --advance-imported-steps 0/, 'displacement is held-render-only and cannot mutate a stepping simulation');
assert.match(exporter, /scalarActivityCueImport/, 'displacement shares the checksum-bound scalar upload transport');

console.log('boundary splat displacement render contracts passed');
