#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SMOKE_OFFER_SCHEMA = 'kaminos.forge-host.smoke-offer.v0';
const LINT_SCHEMA = 'kaminos.preview-bench.smoke-offer-lint.v0';
const DEFAULT_BASE_URL = 'http://127.0.0.1:18137/';

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function textValue(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vector3Value(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return [numberValue(value[0]), numberValue(value[1]), numberValue(value[2])];
  }
  if (value && typeof value === 'object') {
    return [numberValue(value.x), numberValue(value.y), numberValue(value.z)];
  }
  return null;
}

export function collectPreviewBenchObjectMarkers(value, markers = []) {
  if (!value || typeof value !== 'object') return markers;
  if (Array.isArray(value.objectMarkers)) markers.push(...value.objectMarkers);
  if (Array.isArray(value.markers)) markers.push(...value.markers);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') collectPreviewBenchObjectMarkers(child, markers);
  }
  return markers;
}

export function previewBenchCoincidentMarkerGroups(markers, options = {}) {
  const epsilon = numberValue(options.epsilon, 0.0001);
  const groups = new Map();
  for (const [index, marker] of arrayValue(markers).entries()) {
    const value = objectValue(marker);
    const world = vector3Value(value.world || value.position || value.point || value.location);
    if (!world) continue;
    const key = world.map(axis => Math.round(axis / epsilon)).join(':');
    if (!groups.has(key)) {
      groups.set(key, {
        world,
        markerIndices: [],
        markerIds: [],
        markerKinds: [],
      });
    }
    const group = groups.get(key);
    group.markerIndices.push(index);
    group.markerIds.push(textValue(value.id || value.markerId || value.label, `marker-${index + 1}`));
    group.markerKinds.push(textValue(value.kind || value.type || value.route, 'marker'));
  }
  return [...groups.values()]
    .filter(group => group.markerIds.length > 1)
    .map((group, index) => ({
      id: `coincident-marker-group-${index + 1}`,
      count: group.markerIds.length,
      world: group.world,
      markerIndices: group.markerIndices,
      markerIds: group.markerIds,
      markerKinds: group.markerKinds,
    }));
}

function offerListFromDocument(document) {
  if (Array.isArray(document?.offers)) return document.offers;
  if (Array.isArray(document?.smokeOffers)) return document.smokeOffers;
  if (document?.offer && typeof document.offer === 'object') return [document.offer];
  if (document?.payload && typeof document.payload === 'object') return [document.payload];
  if (document && typeof document === 'object') return [document];
  return [];
}

function freshnessBudget(document, offer) {
  return Number(
    offer?.freshnessBudgetMs
      ?? document?.freshnessBudgetMs
      ?? offer?.freshness?.budgetMs
      ?? document?.freshness?.budgetMs
      ?? offer?.freshness?.freshnessBudgetMs
      ?? document?.freshness?.freshnessBudgetMs,
  );
}

export function buildPreviewBenchSmokeUrl({ baseUrl = DEFAULT_BASE_URL, root, path, url } = {}) {
  if (url) return new URL(url, baseUrl).href;
  const smokeUrl = new URL(baseUrl);
  smokeUrl.searchParams.set('smoke_offer_root', textValue(root, 'scratch'));
  smokeUrl.searchParams.set('smoke_offer_path', textValue(path, 'preview-bench-smoke-offer.json'));
  return smokeUrl.href;
}

export function lintPreviewBenchSmokeOffer(document, options = {}) {
  const smokeOffer = objectValue(document);
  const offers = offerListFromDocument(smokeOffer).map(objectValue);
  const errors = [];
  const warnings = [];

  if (smokeOffer.schema !== SMOKE_OFFER_SCHEMA) {
    errors.push({
      code: 'schema-mismatch',
      message: `Expected ${SMOKE_OFFER_SCHEMA}`,
      actual: smokeOffer.schema || null,
    });
  }
  if (!offers.length) {
    errors.push({ code: 'missing-offers', message: 'Smoke offer document must contain at least one offer.' });
  }

  const source = objectValue(smokeOffer.source);
  if (!textValue(source.authority || smokeOffer.authority)) {
    errors.push({ code: 'missing-authority', message: 'Smoke offer must declare source authority.' });
  }
  if (!textValue(source.producerDiaulos || source.producer_diaulos || smokeOffer.producerDiaulos)) {
    warnings.push({ code: 'missing-producer-diaulos', message: 'Smoke offer should declare producer diaulos.' });
  }
  if (!Number.isFinite(freshnessBudget(smokeOffer, offers[0]))) {
    errors.push({ code: 'missing-freshness-budget', message: 'Smoke offer must declare a finite freshness budget.' });
  }
  const acceptanceSurface = objectValue(smokeOffer.acceptanceSurface || offers[0]?.acceptanceSurface);
  if (!textValue(acceptanceSurface.id || acceptanceSurface.route)) {
    errors.push({ code: 'missing-acceptance-surface', message: 'Smoke offer must declare an acceptance surface.' });
  }

  for (const [index, offer] of offers.entries()) {
    if (!textValue(offer.schema || offer.payloadSchema)) {
      errors.push({ code: 'missing-payload-schema', offerIndex: index, message: 'Each offer must preserve the producer payload schema.' });
    }
    if (!arrayValue(offer.downgrades || smokeOffer.downgrades).length) {
      warnings.push({ code: 'missing-downgrade', offerIndex: index, message: 'Offer has no downgrade/fallback declaration.' });
    }
    if (!arrayValue(offer.rejectedDebugSurfaces || offer.rejectedSurfaces || smokeOffer.rejectedDebugSurfaces || smokeOffer.rejectedSurfaces).length) {
      warnings.push({ code: 'missing-rejected-debug-surface', offerIndex: index, message: 'Offer has no rejected debug surfaces.' });
    }
  }

  const markers = collectPreviewBenchObjectMarkers(smokeOffer);
  const coincidentMarkerGroups = previewBenchCoincidentMarkerGroups(markers, { epsilon: options.coincidentEpsilon });
  if (!markers.length) {
    warnings.push({ code: 'missing-visual-hints', message: 'No benchHints.objectMarkers found; Kaminos will synthesize fallback visual markers.' });
  }
  for (const group of coincidentMarkerGroups) {
    warnings.push({
      code: 'coincident-markers',
      message: `${group.count} visual markers share one source coordinate; Kaminos should fan them out for display.`,
      markerIds: group.markerIds,
    });
  }

  const smokeUrl = buildPreviewBenchSmokeUrl(options);
  return {
    ok: errors.length === 0,
    schema: LINT_SCHEMA,
    smokeOfferSchema: smokeOffer.schema || null,
    offerCount: offers.length,
    smokeUrl,
    errors,
    warnings,
    visualHints: {
      source: markers.length ? 'producer-bench-hints' : 'host-summary-fallback',
      markerCount: markers.length,
      coincidentMarkerGroups,
    },
    witnessExpectation: {
      scenario: 'preview-bench-smoke-offer-contract',
      smokeUrl,
      visualState: {
        visible: true,
        markerCount: markers.length || null,
        source: markers.length ? 'producer-bench-hints' : 'host-summary-fallback',
        coincidentMarkerGroupCount: coincidentMarkerGroups.length,
      },
    },
  };
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args.set(arg, 'true');
    else {
      args.set(arg, next);
      i += 1;
    }
  }
  return args;
}

function runCli() {
  const args = parseArgs(process.argv);
  const file = args.get('--file');
  if (!file) {
    console.error('usage: node preview-bench-smoke-offer-tools.mjs --file <offer.json> [--root scratch --path offer.json --base-url http://127.0.0.1:18137/]');
    process.exit(2);
  }
  const document = JSON.parse(readFileSync(file, 'utf8'));
  const lint = lintPreviewBenchSmokeOffer(document, {
    root: args.get('--root'),
    path: args.get('--path'),
    baseUrl: args.get('--base-url') || args.get('--baseUrl') || DEFAULT_BASE_URL,
    url: args.get('--url'),
  });
  console.log(JSON.stringify(lint, null, 2));
  process.exit(lint.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli();
}
