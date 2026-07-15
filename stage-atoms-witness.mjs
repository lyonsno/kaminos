#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  STAGE_ATOMS_ROUTE_IDENTITY,
  buildStageAtomsWitness,
  classifyAudioSourceAccess,
} from './stage-atoms-core.mjs';
import {
  DECODED_AUDIO_FEATURE_AUTHORITY,
  analyzeAudioFile,
  downloadAudioSource,
  selectAudioFeatureFrame,
} from './stage-audio-core.mjs';

const REPORT_SCHEMA = 'kaminos.stage-atoms-witness-report.v0';

function parseArgs(argv) {
  const options = {
    fixture: 'ccmixter',
    output: 'artifacts/stage-atoms/stage-atoms-witness.json',
    audioFile: '',
    featureRate: 20,
    downloadUrl: '',
    sourcePageUrl: '',
    cacheFile: '',
    audioTime: null,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fixture') {
      options.fixture = argv[index + 1] || options.fixture;
      index += 1;
    } else if (arg === '--output') {
      options.output = argv[index + 1] || options.output;
      index += 1;
    } else if (arg === '--audio-file') {
      options.audioFile = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--feature-rate') {
      options.featureRate = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--download-url') {
      options.downloadUrl = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--source-page-url') {
      options.sourcePageUrl = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--cache-file') {
      options.cacheFile = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--audio-time') {
      options.audioTime = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function fixtureInput(name) {
  if (name === 'spotify-reference') {
    return {
      sourceAccess: classifyAudioSourceAccess({
        sourceKind: 'spotify_reference',
        trackId: 'spotify:track:example',
        title: 'Reference Only',
        artist: 'Streaming Artist',
        license: 'streaming_reference',
      }),
      design: { controls: [] },
      graph: { nodes: [], connections: [] },
      audioFeatures: { energy: 1 },
      t: 0,
    };
  }

  if (name === 'ccmixter-geppetto') {
    const fixture = fixtureInput('ccmixter');
    return {
      ...fixture,
      sourceAccess: classifyAudioSourceAccess({
        sourceKind: 'ccmixter',
        trackId: 'ccmixter:70553:file:127740',
        title: 'Geppetto V4 (Pell + Stems) - Dry Main Acapella',
        artist: 'Coruscate',
        license: 'CC BY 2.5',
        attribution: 'Coruscate - Geppetto V4 (Pell + Stems) - Dry Main Acapella - CC BY 2.5 - https://ccmixter.org/files/Coruscate/70553',
        downloadUrl: 'https://ccmixter.org/content/Coruscate/Coruscate_-_Geppetto_V4_(Pell_Stems).mp3',
        sourcePageUrl: 'https://ccmixter.org/files/Coruscate/70553',
        receiptWarnings: ['direct_mp3_probe_returned_403_use_ccmixter_page_or_download_flow'],
      }),
      audioFeatures: {
        energy: 0.69,
        onsetStrength: 0.58,
        recurrenceConfidence: 0.52,
        spectralCentroid: 0.61,
      },
    };
  }

  return {
    sourceAccess: classifyAudioSourceAccess({
      sourceKind: 'ccmixter',
      trackId: 'ccmixter:test-vocal-001',
      title: 'Lawful Test Vocal',
      artist: 'Example Artist',
      license: 'CC BY 3.0',
      attribution: 'Example Artist - Lawful Test Vocal - CC BY 3.0',
      downloadUrl: 'https://ccmixter.example.test/files/example/lawful-test-vocal.wav',
    }),
    design: {
      schema: 'pulp.design-ir.stage-atoms-fixture.v0',
      sourceAdapter: 'pulp-design-ir-derived-fixture',
      controls: [
        {
          id: 'filter.cutoff',
          kind: 'knob',
          label: 'Cutoff',
          paramKey: 'filter.cutoff',
          rect: [410, 180, 64, 64],
          confidence: 0.92,
          sourceNodeId: 'figma-node-cutoff',
        },
        {
          id: 'delay.feedback',
          kind: 'xy_pad',
          label: 'Feedback Space',
          paramKey: 'delay.feedback',
          rect: [240, 310, 140, 120],
          confidence: 0.84,
          sourceNodeId: 'figma-node-feedback',
        },
      ],
      viewport: [800, 600],
    },
    graph: {
      schema: 'pulp.graph-runtime-plan-derived-fixture.v0',
      nodes: [
        { id: 1, kind: 'AudioInput', label: 'Input', level: 0, latencySamples: 0 },
        { id: 2, kind: 'Processor', label: 'Cutoff', level: 1, latencySamples: 64, paramKey: 'filter.cutoff' },
        { id: 3, kind: 'Processor', label: 'Feedback Space', level: 2, latencySamples: 128, paramKey: 'delay.feedback' },
        { id: 4, kind: 'AudioOutput', label: 'Output', level: 3, latencySamples: 0 },
      ],
      connections: [
        { sourceNode: 1, destNode: 2, kind: 'Audio', feedback: false },
        { sourceNode: 2, destNode: 3, kind: 'Automation', feedback: false },
        { sourceNode: 3, destNode: 2, kind: 'Audio', feedback: true },
        { sourceNode: 3, destNode: 4, kind: 'Audio', feedback: false },
      ],
    },
    audioFeatures: {
      energy: 0.73,
      onsetStrength: 0.62,
      recurrenceConfidence: 0.48,
      spectralCentroid: 0.66,
    },
    t: 1.25,
  };
}

function writeJson(path, value) {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function helpText() {
  return [
    'Usage: node stage-atoms-witness.mjs [--fixture name] [--audio-file path | --download-url url --source-page-url url --cache-file path] [--feature-rate hz] [--audio-time seconds] [--output path]',
    '',
    'Writes a stage-atoms witness report. The spotify-reference fixture is expected',
    'to fail and still write last trustworthy source-access evidence.',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log(helpText());
    return 0;
  }

  const input = fixtureInput(options.fixture);
  let audioInput = options.audioFile ? {
    effectivePath: resolve(options.audioFile),
    authority: 'requested-local-audio-file',
    decode: null,
  } : null;
  let downloadReceipt = options.downloadUrl ? {
    requestedUrl: options.downloadUrl,
    effectiveUrl: '',
    sourcePageUrl: options.sourcePageUrl,
    effectivePath: options.cacheFile ? resolve(options.cacheFile) : '',
    statusCode: null,
    contentType: '',
    status: 'requested',
  } : null;
  let featureSelection = null;
  try {
    if (options.audioFile && options.downloadUrl) {
      const error = new Error('audio_file_and_download_url_are_mutually_exclusive');
      error.code = 'audio_input_ambiguous';
      throw error;
    }
    let effectiveAudioFile = options.audioFile;
    if (options.downloadUrl) {
      downloadReceipt = await downloadAudioSource({
        downloadUrl: options.downloadUrl,
        sourcePageUrl: options.sourcePageUrl,
        cacheFile: options.cacheFile,
      });
      effectiveAudioFile = downloadReceipt.effectivePath;
    }
    if (effectiveAudioFile) {
      audioInput = analyzeAudioFile(effectiveAudioFile, { featureRateHz: options.featureRate });
      const selection = selectAudioFeatureFrame(audioInput, { timeSeconds: options.audioTime });
      featureSelection = selection.receipt;
      input.audioFeatures = selection.frame;
      input.t = selection.frame.t;
      input.featureAuthority = DECODED_AUDIO_FEATURE_AUTHORITY;
      input.sourceAccess = {
        ...input.sourceAccess,
        localPath: audioInput.effectivePath,
        receiptWarnings: (input.sourceAccess.receiptWarnings || []).filter(
          warning => warning !== 'direct_mp3_probe_returned_403_use_ccmixter_page_or_download_flow' || downloadReceipt?.status !== 'downloaded',
        ),
      };
    }
    const witness = buildStageAtomsWitness(input);
    const report = {
      schema: REPORT_SCHEMA,
      status: 'passed',
      requestedFixture: options.fixture,
      effectiveRoute: STAGE_ATOMS_ROUTE_IDENTITY,
      witness,
      falseCloseChecks: witness.falseCloseChecks,
      lastTrustworthyEvidence: {
        sourceAccess: input.sourceAccess,
        fixture: options.fixture,
        audioInput,
        downloadReceipt,
        featureSelection,
      },
    };
    writeJson(options.output, report);
    return 0;
  } catch (error) {
    const report = {
      schema: REPORT_SCHEMA,
      status: 'failed',
      failurePhase: error?.code === 'analysis_not_allowed'
        ? 'source_access'
        : error?.code === 'audio_decode_failed'
          ? 'audio_decode'
          : error?.code === 'audio_download_failed'
            ? 'audio_download'
          : 'witness_build',
      errorCode: error?.code || 'unknown_error',
      errorMessage: String(error?.message || error),
      requestedFixture: options.fixture,
      effectiveRoute: STAGE_ATOMS_ROUTE_IDENTITY,
      witness: null,
      lastTrustworthyEvidence: {
        sourceAccess: input.sourceAccess,
        fixture: options.fixture,
        audioInput,
        downloadReceipt: error?.receipt || downloadReceipt,
        featureSelection,
      },
    };
    writeJson(options.output, report);
    return 1;
  }
}

process.exitCode = await main();
