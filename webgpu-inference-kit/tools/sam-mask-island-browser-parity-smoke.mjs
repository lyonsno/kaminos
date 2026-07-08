#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const REPORT_SCHEMA = 'kaminos.sam3-mask-island.browser-parity-smoke.v0';
const MASK_DECODER_ISLAND_ROUTE_ID = 'sam3.mask-decoder-island.webgpu-local.v0';
const MASK_TAIL_PHASE_PROGRAM_ROUTE_ID = 'sam3.mask-tail.phase-program.webgpu-local.v0';
const PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.pixel-decoder.phase-program.webgpu-local.v0';
const PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID = 'sam3.prompt-text-ingress.phase-program.webgpu-local.v0';
const PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID = 'sam3.prompt-fpn.phase-program.webgpu-local.v0';
const DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.detr-encoder.phase-program.webgpu-local.v0';
const DETR_DECODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.detr-decoder.phase-program.webgpu-local.v0';
const SCORING_PHASE_PROGRAM_ROUTE_ID = 'sam3.scoring.phase-program.webgpu-local.v0';
const SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID = 'sam3.selection-postprocess.phase-program.webgpu-local.v0';
const IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-preprocess.phase-program.webgpu-local.v0';
const IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-patch-embed.phase-program.webgpu-local.v0';
const IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-vit-prefix.phase-program.webgpu-local.v0';
const IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-vit-first-block.phase-program.webgpu-local.v0';
const IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-vit-block-stack.phase-program.webgpu-local.v0';
const IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-fpn-neck.phase-program.webgpu-local.v0';
const DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID = DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID;
const DETECTOR_STACK_PACKET_MODE = 'mlx-detector-stack-export';
const DETECTOR_STACK_PREPROCESS_PACKET_MODE = 'mlx-detector-stack-preprocess-export';
const DETECTOR_STACK_PATCH_EMBED_PACKET_MODE = 'mlx-detector-stack-patch-embed-export';
const DETECTOR_STACK_VIT_PREFIX_PACKET_MODE = 'mlx-detector-stack-vit-prefix-export';
const DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE = 'mlx-detector-stack-vit-first-block-export';
const DETECTOR_STACK_VIT_BLOCK_STACK_PACKET_MODE = 'mlx-detector-stack-vit-block-stack-export';
const DETECTOR_STACK_VIT_BACKBONE_PACKET_MODE = 'mlx-detector-stack-vit-backbone-export';
const DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE = 'mlx-detector-stack-image-fpn-neck-export';
const isVitBlockStackPacketMode = mode => mode === DETECTOR_STACK_VIT_BLOCK_STACK_PACKET_MODE || mode === DETECTOR_STACK_VIT_BACKBONE_PACKET_MODE || mode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE;
const isImageFpnNeckPacketMode = mode => mode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE;

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const packageRoot = resolve(new URL('..', import.meta.url).pathname);
const out = resolve(args.get('--out') || '/tmp/kaminos-sam-mask-island-browser-parity.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const debugPort = Number(args.get('--debug-port') || 9527);
const serverPort = Number(args.get('--server-port') || 18527);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-sam-mask-island-profile-${debugPort}-${process.pid}`;
const oracleDir = resolve(args.get('--oracle-dir') || `/tmp/kaminos-sam-mask-island-oracle-${process.pid}`);
const packetMode = args.get('--packet-mode') || 'synthetic';
const packetTool = resolve(args.get('--packet-tool') || (
  packetMode === 'mlx-prompt-fpn-export'
    ? join(packageRoot, 'tools/sam-prompt-fpn-mlx-packet.py')
    : packetMode === 'mlx-scoring-export'
    ? join(packageRoot, 'tools/sam-scoring-mlx-packet.py')
    : packetMode === DETECTOR_STACK_PACKET_MODE
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : isVitBlockStackPacketMode(packetMode)
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === 'mlx-detr-stack-selection-export'
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === 'mlx-detr-stack-scoring-export'
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === 'mlx-detr-stack-export'
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === 'mlx-detr-decoder-export'
    ? join(packageRoot, 'tools/sam-detr-decoder-mlx-packet.py')
    : packetMode === 'mlx-detr-encoder-export'
    ? join(packageRoot, 'tools/sam-detr-encoder-mlx-packet.py')
    : packetMode === 'mlx-pixel-decoder-export'
    ? join(packageRoot, 'tools/sam-pixel-decoder-mlx-packet.py')
    : packetMode === 'mlx-mask-tail-export'
    ? join(packageRoot, 'tools/sam-mask-tail-mlx-packet.py')
    : packetMode === 'mlx-reference-export'
    ? join(packageRoot, 'tools/sam-mask-island-mlx-boundary-packet.py')
    : join(packageRoot, 'tools/sam-mask-island-oracle-packet.mjs')
));
const mlxVlmRoot = resolve(args.get('--mlx-vlm-root') || process.env.KAMINOS_MLX_VLM_ROOT || '/Users/noahlyons/dev/mlx-vlm');
const sourceImage = args.get('--image') || process.env.KAMINOS_SAM3_FIXTURE_IMAGE || '/Users/noahlyons/dev/sam3/assets/images/truck.jpg';
const requestedRouteId = args.get('--route-id') || (
  packetMode === 'mlx-prompt-fpn-export'
    ? PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-scoring-export'
    ? SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === DETECTOR_STACK_PACKET_MODE
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : isVitBlockStackPacketMode(packetMode)
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-stack-selection-export'
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-stack-scoring-export'
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-stack-export'
    ? DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-decoder-export'
    ? DETR_DECODER_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-encoder-export'
    ? DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-pixel-decoder-export'
    ? PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-mask-tail-export'
    ? MASK_TAIL_PHASE_PROGRAM_ROUTE_ID
    : MASK_DECODER_ISLAND_ROUTE_ID
);
const prompt = args.get('--prompt') || (packetMode.startsWith('mlx-') ? 'truck' : 'synthetic mask island parity');
const model = args.get('--model') || 'mlx-community/sam3-image';
const resolution = Number(args.get('--resolution') || 224);
const scoreThreshold = args.get('--score-threshold');
const viewportWidth = Number(args.get('--viewport-width') || 1000);
const viewportHeight = Number(args.get('--viewport-height') || 520);
const hookWaitMs = Number(args.get('--hook-wait-ms') || 20000);
const cdpTimeoutMs = Number(args.get('--cdp-timeout-ms') || 20000);
const settleMs = Number(args.get('--settle-ms') || 400);
const headless = args.get('--headless') !== '0';

let phase = 'initializing';
let stderr = '';
let browserVersion = null;
let primaryOutputWritten = false;
let lastState = null;
let packetManifest = null;
let server = null;
let chromeProcess = null;
const consoleEvents = [];

function manifestTolerance(name, fallback) {
  return packetManifest?.tolerances?.[name] ?? fallback;
}

function effectiveToleranceBudgetSource() {
  return packetManifest?.toleranceBudgetSource || null;
}

function detectorStackReport(state) {
  const detectorStackEvidence = state?.detectorStackEvidence || null;
  if (!detectorStackEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: state.tensorPacket?.boundary || null,
    routeKind: state.tensorPacket?.routeKind || null,
    receiptChain: detectorStackEvidence.receiptChain || [],
    upstreamBoundaries: detectorStackEvidence.upstreamBoundaries || [],
    nonClaims: detectorStackEvidence.nonClaims || {},
    selectionTensorSha256: state.compositionEdge?.selectionTensorSha256 || null,
    selectionOutput: state.compositionEdge?.selectionOutput || null,
    downstreamTensorSha256: state.compositionEdge?.downstreamTensorSha256 || null,
    parity: state.parity || null,
    selectedIndex: detectorStackEvidence.selectedIndex,
    selectedScore: detectorStackEvidence.selectedScore,
    visualSelectedMaskIndex: state.selectedMaskIndex,
    selectedMaskIndexSource: state.selectedMaskIndexSource,
  };
}

function imagePreprocessReport(state) {
  const imagePreprocessEvidence = state?.imagePreprocessEvidence || null;
  if (!imagePreprocessEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: imagePreprocessEvidence.boundary || state.tensorPacket?.boundary || null,
    routeKind: imagePreprocessEvidence.routeKind || state.tensorPacket?.routeKind || null,
    receipt: imagePreprocessEvidence.receipt || null,
    receiptChain: imagePreprocessEvidence.receiptChain || [],
    source: imagePreprocessEvidence.source || null,
    normalization: imagePreprocessEvidence.normalization || null,
    pixelValuesTensorSha256: imagePreprocessEvidence.pixelValuesTensorSha256 || null,
    pixelValuesOutput: imagePreprocessEvidence.pixelValuesOutput || null,
    parity: imagePreprocessEvidence.parity || null,
    debugReadbackSample: imagePreprocessEvidence.debugReadbackSample || [],
    nonClaims: imagePreprocessEvidence.nonClaims || {},
  };
}

function imagePatchEmbedReport(state) {
  const imagePatchEmbedEvidence = state?.imagePatchEmbedEvidence || null;
  if (!imagePatchEmbedEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: imagePatchEmbedEvidence.boundary || state.tensorPacket?.boundary || null,
    routeKind: imagePatchEmbedEvidence.routeKind || state.tensorPacket?.routeKind || null,
    receipt: imagePatchEmbedEvidence.receipt || null,
    receiptChain: imagePatchEmbedEvidence.receiptChain || [],
    source: imagePatchEmbedEvidence.source || null,
    projection: imagePatchEmbedEvidence.projection || null,
    patchEmbeddingsTensorSha256: imagePatchEmbedEvidence.patchEmbeddingsTensorSha256 || null,
    patchEmbeddingsOutput: imagePatchEmbedEvidence.patchEmbeddingsOutput || null,
    patchProjectionWeightSha256: imagePatchEmbedEvidence.patchProjectionWeightSha256 || null,
    parity: imagePatchEmbedEvidence.parity || null,
    debugReadbackSample: imagePatchEmbedEvidence.debugReadbackSample || [],
    nonClaims: imagePatchEmbedEvidence.nonClaims || {},
  };
}

function imageVitPrefixReport(state) {
  const imageVitPrefixEvidence = state?.imageVitPrefixEvidence || null;
  if (!imageVitPrefixEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: imageVitPrefixEvidence.boundary || state.tensorPacket?.boundary || null,
    routeKind: imageVitPrefixEvidence.routeKind || state.tensorPacket?.routeKind || null,
    receipt: imageVitPrefixEvidence.receipt || null,
    receiptChain: imageVitPrefixEvidence.receiptChain || [],
    source: imageVitPrefixEvidence.source || null,
    positionEmbeddings: imageVitPrefixEvidence.positionEmbeddings || null,
    layerNorm: imageVitPrefixEvidence.layerNorm || null,
    vitPrefixHiddenStatesTensorSha256: imageVitPrefixEvidence.vitPrefixHiddenStatesTensorSha256 || null,
    vitPrefixHiddenStatesOutput: imageVitPrefixEvidence.vitPrefixHiddenStatesOutput || null,
    positionEmbeddingsSha256: imageVitPrefixEvidence.positionEmbeddingsSha256 || null,
    backboneLayerNormWeightSha256: imageVitPrefixEvidence.backboneLayerNormWeightSha256 || null,
    backboneLayerNormBiasSha256: imageVitPrefixEvidence.backboneLayerNormBiasSha256 || null,
    parity: imageVitPrefixEvidence.parity || null,
    debugReadbackSample: imageVitPrefixEvidence.debugReadbackSample || [],
    nonClaims: imageVitPrefixEvidence.nonClaims || {},
  };
}

function imageVitFirstBlockReport(state) {
  const imageVitFirstBlockEvidence = state?.imageVitFirstBlockEvidence || null;
  if (!imageVitFirstBlockEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: imageVitFirstBlockEvidence.boundary || state.tensorPacket?.boundary || null,
    routeKind: imageVitFirstBlockEvidence.routeKind || state.tensorPacket?.routeKind || null,
    receipt: imageVitFirstBlockEvidence.receipt || null,
    receiptChain: imageVitFirstBlockEvidence.receiptChain || [],
    source: imageVitFirstBlockEvidence.source || null,
    windowPartition: imageVitFirstBlockEvidence.windowPartition || null,
    ropeWindow: imageVitFirstBlockEvidence.ropeWindow || null,
    layerNorm: imageVitFirstBlockEvidence.layerNorm || null,
    mlp: imageVitFirstBlockEvidence.mlp || null,
    vitFirstBlockHiddenStatesTensorSha256: imageVitFirstBlockEvidence.vitFirstBlockHiddenStatesTensorSha256 || null,
    vitFirstBlockHiddenStatesOutput: imageVitFirstBlockEvidence.vitFirstBlockHiddenStatesOutput || null,
    firstBlockWeightsSha256: imageVitFirstBlockEvidence.firstBlockWeightsSha256 || null,
    parity: imageVitFirstBlockEvidence.parity || null,
    debugReadbackSample: imageVitFirstBlockEvidence.debugReadbackSample || [],
    nonClaims: imageVitFirstBlockEvidence.nonClaims || {},
  };
}

function imageVitBlockStackReport(state) {
  const imageVitBlockStackEvidence = state?.imageVitBlockStackEvidence || null;
  if (!imageVitBlockStackEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: imageVitBlockStackEvidence.boundary || state.tensorPacket?.boundary || null,
    routeKind: imageVitBlockStackEvidence.routeKind || state.tensorPacket?.routeKind || null,
    receipt: imageVitBlockStackEvidence.receipt || null,
    receiptChain: imageVitBlockStackEvidence.receiptChain || [],
    source: imageVitBlockStackEvidence.source || null,
    layerRange: imageVitBlockStackEvidence.layerRange || null,
    windowPartition: imageVitBlockStackEvidence.windowPartition || null,
    globalAttention: imageVitBlockStackEvidence.globalAttention || null,
    rope: imageVitBlockStackEvidence.rope || null,
    layerNorm: imageVitBlockStackEvidence.layerNorm || null,
    mlp: imageVitBlockStackEvidence.mlp || null,
    firstGlobalLayerIndex: imageVitBlockStackEvidence.firstGlobalLayerIndex ?? null,
    finalLayerIndex: imageVitBlockStackEvidence.finalLayerIndex ?? imageVitBlockStackEvidence.layerRange?.finalLayerIndex ?? null,
    fullBackbone: imageVitBlockStackEvidence.fullBackbone === true || imageVitBlockStackEvidence.layerRange?.fullBackbone === true,
    vitBlockStackHiddenStatesTensorSha256: imageVitBlockStackEvidence.vitBlockStackHiddenStatesTensorSha256 || null,
    vitBlockStackHiddenStatesOutput: imageVitBlockStackEvidence.vitBlockStackHiddenStatesOutput || null,
    blockStackWeightsSha256: imageVitBlockStackEvidence.blockStackWeightsSha256 || null,
    parity: imageVitBlockStackEvidence.parity || null,
    debugReadbackSample: imageVitBlockStackEvidence.debugReadbackSample || [],
    nonClaims: imageVitBlockStackEvidence.nonClaims || {},
  };
}

function imageFpnNeckReport(state) {
  const imageFpnNeckEvidence = state?.imageFpnNeckEvidence || null;
  if (!imageFpnNeckEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: imageFpnNeckEvidence.boundary || state.tensorPacket?.boundary || null,
    routeKind: imageFpnNeckEvidence.routeKind || state.tensorPacket?.routeKind || null,
    receipt: imageFpnNeckEvidence.receipt || null,
    receiptChain: imageFpnNeckEvidence.receiptChain || [],
    source: imageFpnNeckEvidence.source || null,
    levels: imageFpnNeckEvidence.levels || null,
    scaleLayers: imageFpnNeckEvidence.scaleLayers || null,
    projection: imageFpnNeckEvidence.projection || null,
    fpnNeckFeature0TensorSha256: imageFpnNeckEvidence.fpnNeckFeature0TensorSha256 || null,
    fpnNeckFeature1TensorSha256: imageFpnNeckEvidence.fpnNeckFeature1TensorSha256 || null,
    fpnNeckFeature2TensorSha256: imageFpnNeckEvidence.fpnNeckFeature2TensorSha256 || null,
    fpnNeckFeature3TensorSha256: imageFpnNeckEvidence.fpnNeckFeature3TensorSha256 || null,
    fpnNeckFeature0Output: imageFpnNeckEvidence.fpnNeckFeature0Output || null,
    fpnNeckFeature1Output: imageFpnNeckEvidence.fpnNeckFeature1Output || null,
    fpnNeckFeature2Output: imageFpnNeckEvidence.fpnNeckFeature2Output || null,
    fpnNeckFeature3Output: imageFpnNeckEvidence.fpnNeckFeature3Output || null,
    fpnNeckWeightsSha256: imageFpnNeckEvidence.fpnNeckWeightsSha256 || null,
    parity: imageFpnNeckEvidence.parity || null,
    debugReadbackSample: imageFpnNeckEvidence.debugReadbackSample || [],
    nonClaims: imageFpnNeckEvidence.nonClaims || {},
  };
}

function browserPromptTextReport(state) {
  const evidence = state?.browserPromptTextEvidence || null;
  if (!evidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: evidence.boundary || null,
    routeKind: evidence.routeKind || null,
    receipt: evidence.receipt || null,
    receiptChain: evidence.receiptChain || [],
    source: evidence.source || null,
    textEncoder: evidence.textEncoder || null,
    promptFeaturesOwner: evidence.promptFeaturesOwner || null,
    promptMaskOwner: evidence.promptMaskOwner || null,
    promptTextTensorSha256: evidence.promptTextTensorSha256 || null,
    promptTextWeightsSha256: evidence.promptTextWeightsSha256 || null,
    promptFeaturesOutput: evidence.promptFeaturesOutput || null,
    promptMaskOutput: evidence.promptMaskOutput || null,
    parity: evidence.parity || null,
    debugReadbackSamples: evidence.debugReadbackSamples || {},
    nonClaims: evidence.nonClaims || {},
  };
}

function assertDetectorStackEvidence(state) {
  const report = detectorStackReport(state);
  if (!report) throw new Error('canonical detectorStack report missing');
  if (report.mode !== DETECTOR_STACK_PACKET_MODE) throw new Error('canonical detectorStack packet mode mismatch');
  if (report.schema !== 'kaminos.sam3-detector-stack-real-boundary-packet.v0') throw new Error('canonical detectorStack schema mismatch');
  if (report.routeKind !== 'detector-stack-browser-local-composition') throw new Error('canonical detectorStack route kind mismatch');
  const expectedReceipts = [
    DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID,
    DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
    SCORING_PHASE_PROGRAM_ROUTE_ID,
    SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
    MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  ];
  if (JSON.stringify(report.receiptChain) !== JSON.stringify(expectedReceipts)) throw new Error('canonical detectorStack receipt chain mismatch');
  if (!report.selectionTensorSha256 || !report.selectionOutput?.sha256 || !report.downstreamTensorSha256) throw new Error('canonical detectorStack composition edge incomplete');
  if (!Array.isArray(report.upstreamBoundaries) || report.upstreamBoundaries.length < 5) throw new Error('canonical detectorStack upstream boundary foothold missing');
  if (report.nonClaims?.fullSam3BrowserExecution !== true || report.nonClaims?.browserLocalVisionEncoder !== true || report.nonClaims?.browserLocalTextEncoder !== true || report.nonClaims?.nms !== true) throw new Error('canonical detectorStack bounded non-claims missing');
  const selectionEmptyEvidenceRejected = Number(report.selectedScore || 0) <= 0;
  if (selectionEmptyEvidenceRejected) throw new Error('canonical detectorStack selected-object evidence is empty');
  if (report.visualSelectedMaskIndex !== report.selectedIndex || report.selectedMaskIndexSource !== 'detector-selection') throw new Error('canonical detectorStack visual selected mask drift');
  if (report.parity?.selectionKeepMismatchCount > 0) throw new Error('canonical detectorStack keep mask mismatch');
  if (report.parity?.selectedIndexMaxAbsDiff > 0) throw new Error('canonical detectorStack selected index mismatch');
  return report;
}

function assertImagePreprocessEvidence(state) {
  const report = imagePreprocessReport(state);
  if (!report) throw new Error('imagePreprocess report missing');
  if (report.mode !== DETECTOR_STACK_PREPROCESS_PACKET_MODE) throw new Error('imagePreprocess packet mode mismatch');
  if (report.schema !== 'kaminos.sam3-detector-stack-image-preprocess-real-boundary-packet.v0') throw new Error('imagePreprocess schema mismatch');
  if (report.routeKind !== 'image-preprocess-detector-stack-composition') throw new Error('imagePreprocess route kind mismatch');
  if (report.receipt?.effectiveRouteId !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePreprocess route receipt identity mismatch');
  if (!Array.isArray(report.receiptChain) || report.receiptChain.length !== 6 || report.receiptChain[0] !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePreprocess composition receipt chain mismatch');
  if (!report.pixelValuesTensorSha256 || !report.pixelValuesOutput?.sha256 || !report.pixelValuesOutput?.artifactId) throw new Error('imagePreprocess pixel-values edge identity missing');
  if (report.parity?.pixelValuesMaxAbsDiff > 0.000001 || report.parity?.imagePreprocessCpuMaxAbsDiff > 0.000001) throw new Error('imagePreprocess pixel-values parity mismatch');
  if (report.nonClaims?.originalImageResize !== true || report.nonClaims?.browserLocalVisionEncoder !== true || report.nonClaims?.browserLocalTextEncoder !== true || report.nonClaims?.fullSam3BrowserExecution !== true) throw new Error('imagePreprocess bounded non-claims missing');
  return report;
}

function assertImagePatchEmbedEvidence(state) {
  const report = imagePatchEmbedReport(state);
  if (!report) throw new Error('imagePatchEmbed report missing');
  if (report.mode !== DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) throw new Error('imagePatchEmbed packet mode mismatch');
  if (report.schema !== 'kaminos.sam3-detector-stack-image-patch-embed-real-boundary-packet.v0') throw new Error('imagePatchEmbed schema mismatch');
  if (report.routeKind !== 'image-patch-embed-detector-stack-composition') throw new Error('imagePatchEmbed route kind mismatch');
  if (report.receipt?.effectiveRouteId !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePatchEmbed route receipt identity mismatch');
  if (!Array.isArray(report.receiptChain) || report.receiptChain.length !== 7 || report.receiptChain[0] !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[1] !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePatchEmbed composition receipt chain mismatch');
  if (!report.patchEmbeddingsTensorSha256 || !report.patchEmbeddingsOutput?.sha256 || !report.patchEmbeddingsOutput?.artifactId || !report.patchProjectionWeightSha256) throw new Error('imagePatchEmbed edge identity missing');
  if (report.parity?.patchEmbeddingsMaxAbsDiff > 0.0005 || report.parity?.imagePatchEmbedCpuMaxAbsDiff > 0.000002) throw new Error('imagePatchEmbed parity mismatch');
  if (report.nonClaims?.originalImageResize !== true || report.nonClaims?.browserLocalViTBlocks !== true || report.nonClaims?.browserLocalFpnNeck !== true || report.nonClaims?.browserLocalTextEncoder !== true || report.nonClaims?.fullSam3BrowserExecution !== true) throw new Error('imagePatchEmbed bounded non-claims missing');
  return report;
}

function assertImageVitPrefixEvidence(state) {
  const report = imageVitPrefixReport(state);
  if (!report) throw new Error('imageVitPrefix report missing');
  if (report.mode !== DETECTOR_STACK_VIT_PREFIX_PACKET_MODE) throw new Error('imageVitPrefix packet mode mismatch');
  if (report.schema !== 'kaminos.sam3-detector-stack-image-vit-prefix-real-boundary-packet.v0') throw new Error('imageVitPrefix schema mismatch');
  if (report.routeKind !== 'image-vit-prefix-detector-stack-composition') throw new Error('imageVitPrefix route kind mismatch');
  if (report.receipt?.effectiveRouteId !== IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageVitPrefix route receipt identity mismatch');
  if (!Array.isArray(report.receiptChain) || report.receiptChain.length !== 8 || report.receiptChain[0] !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[1] !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[2] !== IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageVitPrefix composition receipt chain mismatch');
  if (!report.vitPrefixHiddenStatesTensorSha256 || !report.vitPrefixHiddenStatesOutput?.sha256 || !report.vitPrefixHiddenStatesOutput?.artifactId || !report.positionEmbeddingsSha256 || !report.backboneLayerNormWeightSha256 || !report.backboneLayerNormBiasSha256) throw new Error('imageVitPrefix edge identity missing');
  if (report.positionEmbeddings?.rule !== 'tiling (repeating), not interpolation' || report.layerNorm?.eps !== 0.000001) throw new Error('imageVitPrefix reference boundary metadata missing');
  if (report.parity?.vitPrefixHiddenStatesMaxAbsDiff > 0.0007 || report.parity?.imageVitPrefixCpuMaxAbsDiff > 0.0007) throw new Error('imageVitPrefix parity mismatch');
  if (report.nonClaims?.originalImageResize !== true || report.nonClaims?.browserLocalViTBlocks !== true || report.nonClaims?.browserLocalFpnNeck !== true || report.nonClaims?.browserLocalTextEncoder !== true || report.nonClaims?.fullSam3BrowserExecution !== true) throw new Error('imageVitPrefix bounded non-claims missing');
  return report;
}

function assertImageVitFirstBlockEvidence(state) {
  const report = imageVitFirstBlockReport(state);
  if (!report) throw new Error('imageVitFirstBlock report missing');
  if (report.mode !== DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE) throw new Error('imageVitFirstBlock packet mode mismatch');
  if (report.schema !== 'kaminos.sam3-detector-stack-image-vit-first-block-real-boundary-packet.v0') throw new Error('imageVitFirstBlock schema mismatch');
  if (report.routeKind !== 'image-vit-first-block-detector-stack-composition') throw new Error('imageVitFirstBlock route kind mismatch');
  if (report.receipt?.effectiveRouteId !== IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageVitFirstBlock route receipt identity mismatch');
  if (!Array.isArray(report.receiptChain) || report.receiptChain.length !== 9 || report.receiptChain[0] !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[1] !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[2] !== IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[3] !== IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageVitFirstBlock composition receipt chain mismatch');
  if (!report.vitFirstBlockHiddenStatesTensorSha256 || !report.vitFirstBlockHiddenStatesOutput?.sha256 || !report.vitFirstBlockHiddenStatesOutput?.artifactId || !report.firstBlockWeightsSha256) throw new Error('imageVitFirstBlock edge identity missing');
  if (report.windowPartition?.rule !== 'MLX window partition/pad/crop' || report.ropeWindow?.rule !== 'SAM3 2D axial pairwise RoPE' || report.layerNorm?.eps !== 0.000001 || report.mlp?.activation !== 'gelu') throw new Error('imageVitFirstBlock reference boundary metadata missing');
  if (report.parity?.vitFirstBlockHiddenStatesMaxAbsDiff > 0.0025 || report.parity?.imageVitFirstBlockCpuMaxAbsDiff > 0.0025) throw new Error('imageVitFirstBlock parity mismatch');
  if (report.nonClaims?.remainingViTBlocks !== true || report.nonClaims?.browserLocalFpnNeck !== true || report.nonClaims?.browserLocalTextEncoder !== true || report.nonClaims?.fullSam3BrowserExecution !== true) throw new Error('imageVitFirstBlock bounded non-claims missing');
  return report;
}

function assertImageVitBlockStackEvidence(state) {
  const report = imageVitBlockStackReport(state);
  if (!report) throw new Error('imageVitBlockStack report missing');
  if (!isVitBlockStackPacketMode(report.mode)) throw new Error('imageVitBlockStack packet mode mismatch');
  const isFullBackbone = report.mode === DETECTOR_STACK_VIT_BACKBONE_PACKET_MODE || report.mode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE;
  const expectedChainLength = report.mode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE ? 13 : 9;
  const expectedSchema = report.mode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE ? 'kaminos.sam3-detector-stack-image-fpn-neck-real-boundary-packet.v0' : isFullBackbone ? 'kaminos.sam3-detector-stack-image-vit-backbone-real-boundary-packet.v0' : 'kaminos.sam3-detector-stack-image-vit-block-stack-real-boundary-packet.v0';
  if (report.schema !== expectedSchema) throw new Error('imageVitBlockStack schema mismatch');
  if (report.routeKind !== (isFullBackbone ? 'image-vit-backbone-detector-stack-composition' : 'image-vit-block-stack-detector-stack-composition')) throw new Error('imageVitBlockStack route kind mismatch');
  if (report.receipt?.effectiveRouteId !== IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageVitBlockStack route receipt identity mismatch');
  if (!Array.isArray(report.receiptChain) || report.receiptChain.length !== expectedChainLength || report.receiptChain[0] !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[1] !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[2] !== IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[3] !== IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageVitBlockStack composition receipt chain mismatch');
  if (!report.vitBlockStackHiddenStatesTensorSha256 || !report.vitBlockStackHiddenStatesOutput?.sha256 || !report.vitBlockStackHiddenStatesOutput?.artifactId || !report.blockStackWeightsSha256) throw new Error('imageVitBlockStack edge identity missing');
  if (report.layerRange?.firstGlobalLayerIndex !== report.firstGlobalLayerIndex || report.firstGlobalLayerIndex !== 7) throw new Error('imageVitBlockStack first global layer identity missing');
  if (isFullBackbone && (report.fullBackbone !== true || report.layerRange?.fullBackbone !== true || report.finalLayerIndex !== 31 || report.layerRange?.endLayerIndex !== 31)) throw new Error('imageVitBlockStack full-backbone layer identity missing');
  if (report.windowPartition?.rule !== 'MLX window partition/pad/crop for non-global layers' || report.globalAttention?.firstGlobalLayerIndex !== 7 || report.rope?.rule !== 'SAM3 2D axial pairwise RoPE; window RoPE for non-global layers, actual-grid global RoPE for global layers' || report.layerNorm?.eps !== 0.000001 || report.mlp?.activation !== 'gelu') throw new Error('imageVitBlockStack reference boundary metadata missing');
  if (report.parity?.vitBlockStackHiddenStatesMaxAbsDiff > 0.01 || report.parity?.imageVitBlockStackCpuMaxAbsDiff > 0.01 || report.parity?.vitFirstGlobalHiddenStatesMaxAbsDiff > 0.01 || (isFullBackbone && report.parity?.vitBackboneHiddenStatesMaxAbsDiff > 0.01)) throw new Error('imageVitBlockStack parity mismatch');
  if (report.nonClaims?.remainingViTBlocks !== !isFullBackbone || report.nonClaims?.browserLocalFpnNeck !== true || report.nonClaims?.browserProducedDetrFpnInputs !== true || report.nonClaims?.browserLocalTextEncoder !== true || report.nonClaims?.fullSam3BrowserExecution !== true) throw new Error('imageVitBlockStack bounded non-claims missing');
  return report;
}

function assertImageFpnNeckEvidence(state) {
  const report = imageFpnNeckReport(state);
  if (!report) throw new Error('imageFpnNeck report missing');
  if (report.mode !== DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE) throw new Error('imageFpnNeck packet mode mismatch');
  if (report.schema !== 'kaminos.sam3-detector-stack-image-fpn-neck-real-boundary-packet.v0') throw new Error('imageFpnNeck schema mismatch');
  if (report.routeKind !== 'image-fpn-neck-detector-stack-composition') throw new Error('imageFpnNeck route kind mismatch');
  if (report.receipt?.effectiveRouteId !== IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageFpnNeck route receipt identity mismatch');
  if (!Array.isArray(report.receiptChain) || report.receiptChain.length !== 13 || report.receiptChain[0] !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[1] !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[2] !== IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[3] !== IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[4] !== IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[5] !== PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[7] !== PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[8] !== PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageFpnNeck composition receipt chain mismatch');
  if (!report.fpnNeckFeature0TensorSha256 || !report.fpnNeckFeature3TensorSha256 || !report.fpnNeckFeature0Output?.sha256 || !report.fpnNeckFeature0Output?.artifactId || !report.fpnNeckFeature1Output?.sha256 || !report.fpnNeckFeature2Output?.sha256 || !report.fpnNeckFeature3Output?.sha256 || !report.fpnNeckWeightsSha256) throw new Error('imageFpnNeck edge identity missing');
  if (report.projection?.weightLayout !== 'out,kH,kW,in' || report.projection?.proj1 !== '1x1 Conv2d' || report.projection?.proj2 !== '3x3 Conv2d padding=1') throw new Error('imageFpnNeck reference boundary metadata missing');
  if (report.parity?.fpnNeckFeature0MaxAbsDiff > 0.02 || report.parity?.fpnNeckFeature1MaxAbsDiff > 0.02 || report.parity?.fpnNeckFeature2MaxAbsDiff > 0.02 || report.parity?.fpnNeckFeature3MaxAbsDiff > 0.02 || report.parity?.imageFpnNeckCpuMaxAbsDiff > 0.02) throw new Error('imageFpnNeck parity mismatch');
  const ingress = state?.browserFpnDetrIngressEvidence;
  if (report.nonClaims?.level3DetectorConsumption !== true || report.nonClaims?.fullSam3BrowserExecution !== true) throw new Error('imageFpnNeck bounded non-claims missing');
  if (ingress?.edge?.encoderSrcSource !== 'browser-fpn-neck-feature-2' || !ingress.detrImageIngressTensorSha256 || !ingress.effectiveEncoderSrcSha256 || !ingress.effectiveEncoderPosSha256) throw new Error('imageFpnNeck browser DETR ingress evidence missing');
  if ((ingress?.textTensorOwner === 'browser-local-prompt-text-ingress' && ingress.nonClaims?.browserLocalTextEncoder === true) || (ingress?.edge?.textTensorOwner === 'browser-local-prompt-text-ingress' && ingress.edge?.nonClaims?.browserLocalTextEncoder === true)) throw new Error('imageFpnNeck text ingress evidence still non-claims browser-local text encoder');
  if (ingress?.textTensorOwner === 'browser-local-prompt-text-ingress' && ingress.nonClaims?.browserTokenizer !== true) throw new Error('imageFpnNeck text ingress evidence missing tokenizer non-claim');
  if (effectiveToleranceBudgetSource() !== 'browser-fpn-prompt-text-pixel-detector-stack') throw new Error('imageFpnNeck tolerance budget source mismatch');
  const promptText = browserPromptTextReport(state);
  if (!promptText?.promptTextTensorSha256 || !promptText.promptTextWeightsSha256 || !promptText.promptFeaturesOutput?.sha256 || !promptText.promptMaskOutput?.sha256) throw new Error('imageFpnNeck browser prompt/text evidence missing');
  if (promptText.receipt?.effectiveRouteId !== PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageFpnNeck prompt/text ingress receipt identity mismatch');
  if (promptText.promptFeaturesOwner !== 'browser-local-prompt-text-ingress' || promptText.promptMaskOwner !== 'browser-local-prompt-text-ingress') throw new Error('imageFpnNeck prompt/text owner mismatch');
  if (promptText.parity?.promptTextMaxAbsDiff > 0.001 || promptText.parity?.promptMaskMaxAbsDiff > 0) throw new Error('imageFpnNeck prompt/text parity mismatch');
  const encoderReceipt = state?.compositionRouteReceipts?.find(receipt => receipt?.effectiveRouteId === DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID);
  const detrEncoderInput = encoderReceipt?.inputs?.find(input => input.role === 'sam3-detr-encoder-tensors');
  if (detrEncoderInput?.artifactId !== 'sam3-detr-encoder-tensors:browser-fpn-image-ingress-composition') throw new Error('imageFpnNeck DETR encoder input artifact is not browser FPN image ingress');
  if (detrEncoderInput?.sha256 !== ingress.detrImageIngressTensorSha256) throw new Error('imageFpnNeck DETR encoder input hash does not match browser FPN ingress aggregate');
  const promptPixel = state?.browserPromptFpnPixelEvidence;
  if (!promptPixel?.promptFpnTensorSha256 || !promptPixel.promptFpnOutput?.sha256 || !promptPixel.pixelTensorSha256 || !promptPixel.pixelEmbedOutput?.sha256 || !promptPixel.downstreamTensorSha256) throw new Error('imageFpnNeck browser prompt-FPN/pixel evidence missing');
  if (promptPixel.promptTensorOwner === 'browser-local-prompt-text-ingress' && promptPixel.nonClaims?.browserLocalTextEncoder === true) throw new Error('imageFpnNeck prompt-FPN/pixel evidence still non-claims browser-local text encoder');
  if (promptPixel.promptTensorOwner === 'browser-local-prompt-text-ingress' && promptPixel.nonClaims?.browserTokenizer !== true) throw new Error('imageFpnNeck prompt-FPN/pixel evidence missing tokenizer non-claim');
  if (promptPixel.promptReceipt?.effectiveRouteId !== PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageFpnNeck prompt-FPN route receipt identity mismatch');
  if (promptPixel.pixelReceipt?.effectiveRouteId !== PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageFpnNeck pixel-decoder route receipt identity mismatch');
  const pixelReceiptOutput = promptPixel.pixelReceipt?.outputs?.find(output => output.role === 'pixel-embed');
  if (pixelReceiptOutput?.artifactId !== promptPixel.pixelEmbedOutput.artifactId || pixelReceiptOutput?.sha256 !== promptPixel.pixelEmbedOutput.sha256) throw new Error('imageFpnNeck pixel output identity mismatch');
  const maskReceipt = state?.compositionRouteReceipts?.find(receipt => receipt?.effectiveRouteId === MASK_TAIL_PHASE_PROGRAM_ROUTE_ID);
  const maskInput = maskReceipt?.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
  if (maskInput?.sha256 !== promptPixel.downstreamTensorSha256) throw new Error('imageFpnNeck mask-tail input hash does not match browser pixel downstream aggregate');
  return report;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: REPORT_SCHEMA,
    requestedRouteId,
    effectiveRouteId: lastState?.effectiveRouteId || null,
    requestedUrl: `http://127.0.0.1:${serverPort}/smokes/sam-mask-island-parity.html?manifest=/oracle/tensor-manifest.json`,
    packageRoot,
    oracleDir,
    packetMode,
    packetTool,
    mlxVlmRoot,
    sourceImage: lastState?.sourceImage || lastState?.tensorPacket?.sourceImage || null,
    requestedSourceImage: sourceImage,
    prompt,
    model,
    resolution,
    debugPort,
    serverPort,
    chrome,
    userDataDir,
    viewport: { width: viewportWidth, height: viewportHeight },
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    screenshot: primaryOutputWritten ? out : null,
    browserVersion,
    stderrTail: stderr.slice(-3000),
    consoleEvents,
    lastState,
    backendIdentity: lastState?.backendIdentity || null,
    tensorPacket: lastState?.tensorPacket || null,
    routeReceipt: lastState?.routeReceipt || null,
    midstreamRouteReceipt: lastState?.midstreamRouteReceipt || null,
    downstreamRouteReceipt: lastState?.downstreamRouteReceipt || null,
    compositionRouteReceipts: lastState?.compositionRouteReceipts || null,
    compositionEdge: lastState?.compositionEdge || null,
    browserFpnDetrIngressEvidence: lastState?.browserFpnDetrIngressEvidence || null,
    browserPromptTextEvidence: lastState?.browserPromptTextEvidence || null,
    browserPromptFpnPixelEvidence: lastState?.browserPromptFpnPixelEvidence || null,
    parity: lastState?.parity || null,
    tolerances: packetManifest?.tolerances || null,
    effectiveToleranceBudgetSource: effectiveToleranceBudgetSource(),
    detectorStack: detectorStackReport(lastState),
    imagePreprocess: imagePreprocessReport(lastState),
    imagePatchEmbed: imagePatchEmbedReport(lastState),
    imageVitPrefix: imageVitPrefixReport(lastState),
    imageVitFirstBlock: imageVitFirstBlockReport(lastState),
    imageVitBlockStack: imageVitBlockStackReport(lastState),
    imageFpnNeck: imageFpnNeckReport(lastState),
    browserPromptText: browserPromptTextReport(lastState),
    ...extra,
  }, null, 2));
}

function withFailurePhase(error, failurePhase) {
  if (error && typeof error === 'object') {
    error.failurePhase = failurePhase;
    return error;
  }
  const wrapped = new Error(String(error));
  wrapped.failurePhase = failurePhase;
  return wrapped;
}

function contentType(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.bin') return 'application/octet-stream';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function startServer() {
  server = createServer((request, response) => {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${serverPort}`);
      const root = url.pathname.startsWith('/oracle/') ? oracleDir : packageRoot;
      const relative = url.pathname.startsWith('/oracle/')
        ? url.pathname.slice('/oracle/'.length)
        : url.pathname.slice(1);
      const filePath = resolve(root, relative || 'smokes/sam-mask-island-parity.html');
      if (!filePath.startsWith(root)) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }
      if (!existsSync(filePath)) {
        response.writeHead(404);
        response.end(`missing ${url.pathname}`);
        return;
      }
      response.writeHead(200, {
        'content-type': contentType(filePath),
        'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      });
      response.end(readFileSync(filePath));
    } catch (error) {
      response.writeHead(500);
      response.end(String(error?.stack || error));
    }
  });
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(serverPort, '127.0.0.1', resolveListen);
  });
}

function generateOraclePacket() {
  mkdirSync(oracleDir, { recursive: true });
  const isPython = packetTool.endsWith('.py');
  const command = isPython ? 'uv' : process.execPath;
  const packetArgs = isPython
    ? [
        'run',
        '--project', mlxVlmRoot,
        'python',
        packetTool,
        '--out-dir', oracleDir,
        '--image', sourceImage,
        '--prompt', prompt,
        '--model', model,
        '--resolution', String(resolution),
      ]
    : [
        packetTool,
        '--out-dir', oracleDir,
        '--batch', '1',
        '--mask-tokens', '1',
        '--channels', '2',
        '--height', '8',
        '--width', '8',
        '--source-image-artifact-id', 'image:synthetic-sam-browser-parity',
        '--source-image-sha256', 'sha256:synthetic-browser-parity-image',
        '--prompt', prompt,
        '--model', model,
      ];
  if (isPython && packetMode === 'mlx-detr-stack-scoring-export') packetArgs.push('--include-scoring');
  if (isPython && packetMode === DETECTOR_STACK_PACKET_MODE) packetArgs.push('--detector-stack');
  if (isPython && packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE) packetArgs.push('--image-preprocess-ingress');
  if (isPython && packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) packetArgs.push('--image-patch-embed-ingress');
  if (isPython && packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE) packetArgs.push('--image-vit-prefix-ingress');
  if (isPython && packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE) packetArgs.push('--image-vit-first-block-ingress');
  if (isPython && packetMode === DETECTOR_STACK_VIT_BLOCK_STACK_PACKET_MODE) packetArgs.push('--image-vit-block-stack-ingress');
  if (isPython && packetMode === DETECTOR_STACK_VIT_BACKBONE_PACKET_MODE) packetArgs.push('--image-vit-full-backbone-ingress');
  if (isPython && packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE) packetArgs.push('--image-fpn-neck-ingress');
  if (isPython && packetMode === 'mlx-detr-stack-selection-export') packetArgs.push('--include-selection');
  if (isPython && (packetMode === 'mlx-detr-stack-selection-export' || packetMode === DETECTOR_STACK_PACKET_MODE || packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE || packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) && scoreThreshold != null) packetArgs.push('--score-threshold', scoreThreshold);
  const proc = spawnSync(command, packetArgs, {
    cwd: isPython ? mlxVlmRoot : packageRoot,
    encoding: 'utf8',
    timeout: isPython ? 120000 : undefined,
  });
  if (proc.status !== 0) {
    throw new Error(`oracle packet generation failed: ${proc.stderr || proc.stdout}`);
  }
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let i = 0; i < 100; i += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, cdpTimeoutMs);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({
          method: msg.method,
          type: msg.params.type,
          text: (msg.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
        });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({
          method: msg.method,
          type: 'exception',
          text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'Runtime exception',
        });
      }
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function main() {
  try {
    phase = 'generate_oracle_packet';
    generateOraclePacket();
    packetManifest = JSON.parse(readFileSync(join(oracleDir, 'tensor-manifest.json'), 'utf8'));

    phase = 'start_server';
    await startServer();

    const url = `http://127.0.0.1:${serverPort}/smokes/sam-mask-island-parity.html?manifest=/oracle/tensor-manifest.json`;
    phase = 'launch_chrome';
    const chromeArgs = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures',
      `--window-size=${viewportWidth},${viewportHeight}`,
    ];
    if (headless) chromeArgs.push('--headless=new');
    chromeArgs.push(url);
    chromeProcess = spawn(chrome, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    const chromeSpawnError = new Promise((_, rejectSpawn) => {
      chromeProcess.once('error', error => {
        rejectSpawn(withFailurePhase(error, 'launch_chrome'));
      });
    });
    chromeProcess.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    phase = 'connect_cdp';
    browserVersion = await Promise.race([waitForCdp(), chromeSpawnError]);
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.type === 'page' && candidate.url.includes('sam-mask-island-parity.html')) || pages[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome page target missing debugger URL');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });

    phase = 'wait_parity_state';
    const deadline = Date.now() + hookWaitMs;
    while (Date.now() < deadline) {
      lastState = await evaluate(ws, `(() => {
        const read = window.samMaskIslandParitySmokeState;
        return typeof read === 'function' ? read() : null;
      })()`);
      if (lastState?.status === 'passed' || lastState?.status === 'failed') break;
      await delay(250);
    }
    if (!lastState) throw new Error('missing samMaskIslandParitySmokeState');
    if (lastState.status !== 'passed') {
      throw new Error(`SAM browser parity did not pass: ${JSON.stringify(lastState)}`);
    }
    if (lastState.requestedRouteId !== requestedRouteId || lastState.effectiveRouteId !== requestedRouteId) {
      throw new Error(`route identity mismatch: ${lastState.requestedRouteId} -> ${lastState.effectiveRouteId}`);
    }
    if (!lastState.backendIdentity?.adapterName) throw new Error('backendIdentity.adapterName missing');
    if (requestedRouteId === SCORING_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.hiddenStatesSha256 || !lastState.tensorPacket?.promptFeaturesSha256 || !lastState.tensorPacket?.promptMaskSha256 || !lastState.tensorPacket?.expectedPredLogitsSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('SAM3 scoring tensorPacket identity missing');
      }
      const scoringInput = lastState.routeReceipt?.inputs?.find(input => input.role === 'sam3-scoring-tensors');
      if (!scoringInput?.sha256) throw new Error('SAM3 scoring receipt tensor input missing');
      const predLogitsOutput = lastState.routeReceipt?.outputs?.find(output => output.role === 'pred-logits');
      if (!predLogitsOutput?.sha256 || !predLogitsOutput?.artifactId) throw new Error('SAM3 scoring pred-logits output identity missing');
      if (lastState.parity?.predLogitsMaxAbsDiff > 0.0005) throw new Error('SAM3 scoring pred-logits parity exceeds tolerance');
      if (lastState.parity?.expectedElementCount !== lastState.parity?.gpuElementCount) throw new Error('SAM3 scoring element count mismatch');
    } else if (packetMode === 'mlx-detr-stack-selection-export' || packetMode === DETECTOR_STACK_PACKET_MODE || packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE || packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) {
      if (!lastState.tensorPacket?.expectedSelectionScoresSha256 || !lastState.tensorPacket?.expectedSelectionBoxesSha256 || !lastState.tensorPacket?.expectedSelectionKeepSha256 || !lastState.tensorPacket?.expectedSelectedIndexSha256 || !lastState.tensorPacket?.expectedSelectedScoreSha256 || !lastState.tensorPacket?.expectedSelectedBoxSha256) {
        throw new Error('DETR stack selection tensorPacket identity missing');
      }
      if ((packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) && (!lastState.tensorPacket?.expectedPixelValuesSha256 || !lastState.tensorPacket?.expectedPatchEmbeddingsSha256 || !lastState.tensorPacket?.patchProjectionWeightSha256)) {
        throw new Error('imagePatchEmbed detector stack tensorPacket identity missing');
      }
      if ((packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) && (!lastState.tensorPacket?.expectedVitPrefixHiddenStatesSha256 || !lastState.tensorPacket?.positionEmbeddingsSha256 || !lastState.tensorPacket?.backboneLayerNormWeightSha256 || !lastState.tensorPacket?.backboneLayerNormBiasSha256)) {
        throw new Error('imageVitPrefix detector stack tensorPacket identity missing');
      }
      if (packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE && (!lastState.tensorPacket?.expectedVitFirstBlockHiddenStatesSha256 || !lastState.tensorPacket?.firstBlockWeightsSha256)) {
        throw new Error('imageVitFirstBlock detector stack tensorPacket identity missing');
      }
      if (isVitBlockStackPacketMode(packetMode) && (!lastState.tensorPacket?.expectedVitBlockStackHiddenStatesSha256 || !lastState.tensorPacket?.expectedVitFirstGlobalHiddenStatesSha256 || !lastState.tensorPacket?.blockStackWeightsSha256)) {
        throw new Error('imageVitBlockStack detector stack tensorPacket identity missing');
      }
      if ((packetMode === DETECTOR_STACK_VIT_BACKBONE_PACKET_MODE || packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE) && !lastState.tensorPacket?.expectedVitBackboneHiddenStatesSha256) throw new Error('imageVitBlockStack full-backbone tensorPacket identity missing');
      if (packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE && (!lastState.tensorPacket?.expectedFpnNeckFeature0Sha256 || !lastState.tensorPacket?.expectedFpnNeckFeature1Sha256 || !lastState.tensorPacket?.expectedFpnNeckFeature2Sha256 || !lastState.tensorPacket?.expectedFpnNeckFeature3Sha256 || !lastState.tensorPacket?.promptInputIdsSha256 || !lastState.tensorPacket?.promptAttentionMaskSha256 || !lastState.tensorPacket?.expectedPromptFeaturesSha256 || !lastState.tensorPacket?.expectedPromptMaskSha256 || !lastState.tensorPacket?.expectedPromptFpnFeatureSha256 || !lastState.tensorPacket?.expectedPixelEmbedSha256 || !lastState.tensorPacket?.fpnNeckWeightsSha256 || !lastState.tensorPacket?.promptTextWeightsSha256 || !lastState.tensorPacket?.promptFpnWeightsSha256 || !lastState.tensorPacket?.pixelDecoderWeightsSha256)) {
        throw new Error('imageFpnNeck detector stack tensorPacket identity missing');
      }
      if (packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE && (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 13)) {
        throw new Error('imageFpnNeck detector stack composition receipt chain missing');
      }
      if ((packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || (isVitBlockStackPacketMode(packetMode) && packetMode !== DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE)) && (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 9)) {
        throw new Error('imageVitFirstBlock detector stack composition receipt chain missing');
      }
      if (packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE && (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 8)) {
        throw new Error('imageVitPrefix detector stack composition receipt chain missing');
      }
      if (packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE && (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 7)) {
        throw new Error('imagePatchEmbed detector stack composition receipt chain missing');
      }
      if (packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE && (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 6)) {
        throw new Error('imagePreprocess detector stack composition receipt chain missing');
      }
      if (packetMode !== DETECTOR_STACK_PREPROCESS_PACKET_MODE && packetMode !== DETECTOR_STACK_PATCH_EMBED_PACKET_MODE && packetMode !== DETECTOR_STACK_VIT_PREFIX_PACKET_MODE && packetMode !== DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE && !isVitBlockStackPacketMode(packetMode) && (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 5)) {
        throw new Error('DETR stack selection composition receipt chain missing');
      }
      const receiptOffset = packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE ? 5 : (packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) ? 4 : packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE ? 3 : packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE ? 2 : packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE ? 1 : 0;
      const imagePreprocessReceipt = packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE || packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode) ? lastState.compositionRouteReceipts[0] : null;
      const imagePatchEmbedReceipt = packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode) ? lastState.compositionRouteReceipts[1] : null;
      const imageVitPrefixReceipt = packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode) ? lastState.compositionRouteReceipts[2] : null;
      const imageVitFirstBlockReceipt = packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE ? lastState.compositionRouteReceipts[3] : null;
      const imageVitBlockStackReceipt = isVitBlockStackPacketMode(packetMode) ? lastState.compositionRouteReceipts[3] : null;
      const imageFpnNeckReceipt = packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE ? lastState.compositionRouteReceipts[4] : null;
      const downstreamReceipts = lastState.compositionRouteReceipts.slice(receiptOffset);
      const [
        promptTextReceipt,
        encoderReceipt,
        promptFpnReceipt,
        pixelDecoderReceipt,
        decoderReceipt,
        scoringReceipt,
        selectionReceipt,
        tailReceipt,
      ] = packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE
        ? downstreamReceipts
        : [
          null,
          downstreamReceipts[0],
          null,
          null,
          downstreamReceipts[1],
          downstreamReceipts[2],
          downstreamReceipts[3],
          downstreamReceipts[4],
        ];
      const compositionEdge = lastState.compositionEdge;
      if ((packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE || packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) && imagePreprocessReceipt.effectiveRouteId !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePreprocess receipt identity mismatch');
      if ((packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) && imagePatchEmbedReceipt.effectiveRouteId !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePatchEmbed receipt identity mismatch');
      if ((packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) && imageVitPrefixReceipt.effectiveRouteId !== IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageVitPrefix receipt identity mismatch');
      if (packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE && imageVitFirstBlockReceipt.effectiveRouteId !== IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageVitFirstBlock receipt identity mismatch');
      if (isVitBlockStackPacketMode(packetMode) && imageVitBlockStackReceipt.effectiveRouteId !== IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageVitBlockStack receipt identity mismatch');
      if (packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE && imageFpnNeckReceipt.effectiveRouteId !== IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageFpnNeck receipt identity mismatch');
      if (packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) {
        const patchInput = imagePatchEmbedReceipt.inputs?.find(input => input.role === 'pixel-values');
        if (patchInput?.sha256 !== compositionEdge?.pixelValuesOutput?.sha256) throw new Error('imagePatchEmbed pixel-values input does not match preprocess output');
        const patchOutput = imagePatchEmbedReceipt.outputs?.find(output => output.role === 'patch-embeddings');
        if (
          patchOutput?.artifactId !== compositionEdge?.patchEmbeddingsOutput?.artifactId
          || patchOutput?.sha256 !== compositionEdge?.patchEmbeddingsOutput?.sha256
          || JSON.stringify(patchOutput?.shape) !== JSON.stringify(compositionEdge?.patchEmbeddingsOutput?.shape)
        ) {
          throw new Error('imagePatchEmbed output identity does not match composition edge');
        }
      }
      if (packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE || packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE || isVitBlockStackPacketMode(packetMode)) {
        const vitInput = imageVitPrefixReceipt.inputs?.find(input => input.role === 'patch-embeddings');
        if (vitInput?.sha256 !== compositionEdge?.patchEmbeddingsOutput?.sha256) throw new Error('imageVitPrefix patch input does not match patch-embed output');
        const vitOutput = imageVitPrefixReceipt.outputs?.find(output => output.role === 'vit-prefix-hidden-states');
        if (
          vitOutput?.artifactId !== compositionEdge?.vitPrefixHiddenStatesOutput?.artifactId
          || vitOutput?.sha256 !== compositionEdge?.vitPrefixHiddenStatesOutput?.sha256
          || JSON.stringify(vitOutput?.shape) !== JSON.stringify(compositionEdge?.vitPrefixHiddenStatesOutput?.shape)
        ) {
          throw new Error('imageVitPrefix output identity does not match composition edge');
        }
      }
      if (packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE) {
        const firstBlockInput = imageVitFirstBlockReceipt.inputs?.find(input => input.role === 'vit-prefix-hidden-states');
        if (firstBlockInput?.sha256 !== compositionEdge?.vitPrefixHiddenStatesOutput?.sha256) throw new Error('imageVitFirstBlock input does not match ViT-prefix output');
        const firstBlockOutput = imageVitFirstBlockReceipt.outputs?.find(output => output.role === 'vit-first-block-hidden-states');
        if (
          firstBlockOutput?.artifactId !== compositionEdge?.vitFirstBlockHiddenStatesOutput?.artifactId
          || firstBlockOutput?.sha256 !== compositionEdge?.vitFirstBlockHiddenStatesOutput?.sha256
          || JSON.stringify(firstBlockOutput?.shape) !== JSON.stringify(compositionEdge?.vitFirstBlockHiddenStatesOutput?.shape)
        ) {
          throw new Error('imageVitFirstBlock output identity does not match composition edge');
        }
      }
      if (isVitBlockStackPacketMode(packetMode)) {
        const blockStackInput = imageVitBlockStackReceipt.inputs?.find(input => input.role === 'vit-prefix-hidden-states');
        if (blockStackInput?.sha256 !== compositionEdge?.vitPrefixHiddenStatesOutput?.sha256) throw new Error('imageVitBlockStack input does not match ViT-prefix output');
        const blockStackOutput = imageVitBlockStackReceipt.outputs?.find(output => output.role === 'vit-block-stack-hidden-states');
        if (
          blockStackOutput?.artifactId !== compositionEdge?.vitBlockStackHiddenStatesOutput?.artifactId
          || blockStackOutput?.sha256 !== compositionEdge?.vitBlockStackHiddenStatesOutput?.sha256
          || JSON.stringify(blockStackOutput?.shape) !== JSON.stringify(compositionEdge?.vitBlockStackHiddenStatesOutput?.shape)
        ) {
          throw new Error('imageVitBlockStack output identity does not match composition edge');
        }
      }
      if (packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE) {
        const fpnInput = imageFpnNeckReceipt.inputs?.find(input => input.role === 'vit-backbone-hidden-states');
        if (fpnInput?.sha256 !== compositionEdge?.vitBlockStackHiddenStatesOutput?.sha256) throw new Error('imageFpnNeck input does not match full-backbone output');
        for (const level of [0, 1, 2, 3]) {
          const fpnOutput = imageFpnNeckReceipt.outputs?.find(output => output.role === `fpn-neck-feature-${level}`);
          const edgeOutput = compositionEdge?.[`fpnNeckFeature${level}Output`];
          if (
            fpnOutput?.artifactId !== edgeOutput?.artifactId
            || fpnOutput?.sha256 !== edgeOutput?.sha256
            || JSON.stringify(fpnOutput?.shape) !== JSON.stringify(edgeOutput?.shape)
          ) {
            throw new Error(`imageFpnNeck feature ${level} output identity does not match composition edge`);
          }
        }
        if (promptTextReceipt?.effectiveRouteId !== PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageFpnNeck prompt/text receipt identity mismatch');
        const promptFeaturesOutput = promptTextReceipt.outputs?.find(output => output.role === 'prompt-features');
        const promptMaskOutput = promptTextReceipt.outputs?.find(output => output.role === 'prompt-mask');
        if (
          promptFeaturesOutput?.artifactId !== compositionEdge?.promptFeaturesOutput?.artifactId
          || promptFeaturesOutput?.sha256 !== compositionEdge?.promptFeaturesOutput?.sha256
          || promptMaskOutput?.artifactId !== compositionEdge?.promptMaskOutput?.artifactId
          || promptMaskOutput?.sha256 !== compositionEdge?.promptMaskOutput?.sha256
        ) {
          throw new Error('imageFpnNeck prompt/text output identity does not match composition edge');
        }
        if (promptFpnReceipt?.effectiveRouteId !== PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageFpnNeck prompt-FPN receipt identity mismatch');
        if (pixelDecoderReceipt?.effectiveRouteId !== PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('imageFpnNeck pixel-decoder receipt identity mismatch');
        const promptFpnOutput = promptFpnReceipt.outputs?.find(output => output.role === 'prompt-fpn-feature');
        if (
          promptFpnOutput?.artifactId !== compositionEdge?.promptFpnOutput?.artifactId
          || promptFpnOutput?.sha256 !== compositionEdge?.promptFpnOutput?.sha256
          || JSON.stringify(promptFpnOutput?.shape) !== JSON.stringify(compositionEdge?.promptFpnOutput?.shape)
        ) {
          throw new Error('imageFpnNeck prompt-FPN output identity does not match composition edge');
        }
        const pixelDecoderOutput = pixelDecoderReceipt.outputs?.find(output => output.role === 'pixel-embed');
        if (
          pixelDecoderOutput?.artifactId !== compositionEdge?.pixelEmbedOutput?.artifactId
          || pixelDecoderOutput?.sha256 !== compositionEdge?.pixelEmbedOutput?.sha256
          || JSON.stringify(pixelDecoderOutput?.shape) !== JSON.stringify(compositionEdge?.pixelEmbedOutput?.shape)
        ) {
          throw new Error('imageFpnNeck pixel-decoder output identity does not match composition edge');
        }
      }
      if (encoderReceipt.effectiveRouteId !== DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection encoder receipt identity mismatch');
      if (decoderReceipt.effectiveRouteId !== DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection decoder receipt identity mismatch');
      if (scoringReceipt.effectiveRouteId !== SCORING_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection scoring receipt identity mismatch');
      if (selectionReceipt.effectiveRouteId !== SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection mask-tail receipt identity mismatch');
      const selectionInput = selectionReceipt.inputs?.find(input => input.role === 'sam3-selection-tensors');
      if (selectionInput?.sha256 !== compositionEdge?.selectionTensorSha256) throw new Error('DETR stack selectionTensorSha256 does not match selection receipt input');
      const selectionOutput = selectionReceipt.outputs?.find(output => output.role === 'selected-index');
      if (
        selectionOutput?.artifactId !== compositionEdge?.selectionOutput?.artifactId
        || selectionOutput?.sha256 !== compositionEdge?.selectionOutput?.sha256
        || JSON.stringify(selectionOutput?.shape) !== JSON.stringify(compositionEdge?.selectionOutput?.shape)
      ) {
        throw new Error('DETR stack selection output identity does not match composition edge');
      }
      if (lastState.parity?.predLogitsMaxAbsDiff > manifestTolerance('predLogitsMaxAbsDiff', 0.0005)) throw new Error('DETR stack selection pred-logits parity exceeds tolerance');
      if (lastState.parity?.selectionScoresMaxAbsDiff > manifestTolerance('selectionScoresMaxAbsDiff', 0.00001)) throw new Error('DETR stack selection scores parity exceeds tolerance');
      if (lastState.parity?.selectionBoxesMaxAbsDiff > manifestTolerance('selectionBoxesMaxAbsDiff', 0.0002)) throw new Error('DETR stack selection boxes parity exceeds tolerance');
      if (lastState.parity?.selectionKeepMismatchCount > manifestTolerance('selectionKeepMismatchCount', 0)) throw new Error('DETR stack selection keep mask mismatch');
      if (lastState.parity?.selectedIndexMaxAbsDiff > manifestTolerance('selectedIndexMaxAbsDiff', 0)) throw new Error('DETR stack selected index parity exceeds tolerance');
      if (lastState.parity?.selectedScoreMaxAbsDiff > manifestTolerance('selectedScoreMaxAbsDiff', 0.00001)) throw new Error('DETR stack selected score parity exceeds tolerance');
      if (lastState.parity?.selectedBoxMaxAbsDiff > manifestTolerance('selectedBoxMaxAbsDiff', 0.0001)) throw new Error('DETR stack selected box parity exceeds tolerance');
      if (packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE && lastState.parity?.vitPrefixHiddenStatesMaxAbsDiff > 0.0007) throw new Error('imageVitPrefix detector stack hidden-state parity exceeds tolerance');
      if (packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE && lastState.parity?.imageVitPrefixCpuMaxAbsDiff > 0.0007) throw new Error('imageVitPrefix CPU oracle parity exceeds tolerance');
      if (packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE && lastState.parity?.vitFirstBlockHiddenStatesMaxAbsDiff > 0.0025) throw new Error('imageVitFirstBlock detector stack hidden-state parity exceeds tolerance');
      if (packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE && lastState.parity?.imageVitFirstBlockCpuMaxAbsDiff > 0.0025) throw new Error('imageVitFirstBlock CPU oracle parity exceeds tolerance');
      if (isVitBlockStackPacketMode(packetMode) && lastState.parity?.vitBlockStackHiddenStatesMaxAbsDiff > 0.01) throw new Error('imageVitBlockStack detector stack hidden-state parity exceeds tolerance');
      if (isVitBlockStackPacketMode(packetMode) && lastState.parity?.imageVitBlockStackCpuMaxAbsDiff > 0.01) throw new Error('imageVitBlockStack CPU oracle parity exceeds tolerance');
      if (isVitBlockStackPacketMode(packetMode) && lastState.parity?.vitFirstGlobalHiddenStatesMaxAbsDiff > 0.01) throw new Error('imageVitBlockStack first-global parity exceeds tolerance');
      if ((packetMode === DETECTOR_STACK_VIT_BACKBONE_PACKET_MODE || packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE) && lastState.parity?.vitBackboneHiddenStatesMaxAbsDiff > 0.01) throw new Error('imageVitBlockStack full-backbone parity exceeds tolerance');
      if (packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE && (lastState.parity?.fpnNeckFeature0MaxAbsDiff > 0.02 || lastState.parity?.fpnNeckFeature1MaxAbsDiff > 0.02 || lastState.parity?.fpnNeckFeature2MaxAbsDiff > 0.02 || lastState.parity?.fpnNeckFeature3MaxAbsDiff > 0.02 || lastState.parity?.imageFpnNeckCpuMaxAbsDiff > 0.02)) throw new Error('imageFpnNeck parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > manifestTolerance('binaryMismatchCount', 8)) throw new Error('DETR stack selection binary mask parity exceeds tolerance');
      if (packetMode === DETECTOR_STACK_PACKET_MODE) assertDetectorStackEvidence(lastState);
      if (packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE) assertImagePreprocessEvidence(lastState);
      if (packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) assertImagePatchEmbedEvidence(lastState);
      if (packetMode === DETECTOR_STACK_VIT_PREFIX_PACKET_MODE) assertImageVitPrefixEvidence(lastState);
      if (packetMode === DETECTOR_STACK_VIT_FIRST_BLOCK_PACKET_MODE) assertImageVitFirstBlockEvidence(lastState);
      if (isVitBlockStackPacketMode(packetMode)) assertImageVitBlockStackEvidence(lastState);
      if (packetMode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE) assertImageFpnNeckEvidence(lastState);
    } else if (packetMode === 'mlx-detr-stack-scoring-export') {
      if (!lastState.tensorPacket?.encoderSrcSha256 || !lastState.tensorPacket?.encoderPosSha256 || !lastState.tensorPacket?.expectedEncoderHiddenStatesSha256 || !lastState.tensorPacket?.expectedDecoderHiddenStatesSha256 || !lastState.tensorPacket?.expectedLastHsSha256 || !lastState.tensorPacket?.expectedReferenceBoxesSha256 || !lastState.tensorPacket?.expectedPresenceLogitsSha256 || !lastState.tensorPacket?.expectedPredLogitsSha256 || !lastState.tensorPacket?.pixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('DETR stack scoring tensorPacket identity missing');
      }
      if (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 4) {
        throw new Error('DETR stack scoring composition receipt chain missing');
      }
      const [encoderReceipt, decoderReceipt, scoringReceipt, tailReceipt] = lastState.compositionRouteReceipts;
      const compositionEdge = lastState.compositionEdge;
      if (encoderReceipt.effectiveRouteId !== DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack scoring encoder receipt identity mismatch');
      if (decoderReceipt.effectiveRouteId !== DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack scoring decoder receipt identity mismatch');
      if (scoringReceipt.effectiveRouteId !== SCORING_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack scoring receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack scoring mask-tail receipt identity mismatch');
      const decoderHiddenStatesOutput = decoderReceipt.outputs?.find(output => output.role === 'decoder-hidden-states');
      if (
        decoderHiddenStatesOutput?.artifactId !== compositionEdge?.decoderHiddenStatesOutput?.artifactId
        || decoderHiddenStatesOutput?.sha256 !== compositionEdge?.decoderHiddenStatesOutput?.sha256
        || JSON.stringify(decoderHiddenStatesOutput?.shape) !== JSON.stringify(compositionEdge?.decoderHiddenStatesOutput?.shape)
      ) {
        throw new Error('DETR stack scoring decoder-hidden-states output identity does not match composition edge');
      }
      const scoringInput = scoringReceipt.inputs?.find(input => input.role === 'sam3-scoring-tensors');
      if (scoringInput?.sha256 !== compositionEdge?.scoringTensorSha256) throw new Error('DETR stack scoringTensorSha256 does not match scoring receipt input');
      const scoringOutput = scoringReceipt.outputs?.find(output => output.role === 'pred-logits');
      if (
        scoringOutput?.artifactId !== compositionEdge?.scoringOutput?.artifactId
        || scoringOutput?.sha256 !== compositionEdge?.scoringOutput?.sha256
        || JSON.stringify(scoringOutput?.shape) !== JSON.stringify(compositionEdge?.scoringOutput?.shape)
      ) {
        throw new Error('DETR stack scoring output identity does not match composition edge');
      }
      const downstreamTensorInput = tailReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('DETR stack scoring downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.encoderHiddenStatesMaxAbsDiff > 0.0003) throw new Error('DETR stack scoring encoder parity exceeds tolerance');
      if (lastState.parity?.decoderHiddenStatesMaxAbsDiff > 0.0006) throw new Error('DETR stack scoring decoder hidden-state parity exceeds tolerance');
      if (lastState.parity?.lastHsMaxAbsDiff > 0.0006) throw new Error('DETR stack scoring last-hs parity exceeds tolerance');
      if (lastState.parity?.referenceBoxesMaxAbsDiff > 0.0006) throw new Error('DETR stack scoring reference-box parity exceeds tolerance');
      if (lastState.parity?.presenceLogitsMaxAbsDiff > 0.0006) throw new Error('DETR stack scoring presence parity exceeds tolerance');
      if (lastState.parity?.predLogitsMaxAbsDiff > 0.0005) throw new Error('DETR stack scoring pred-logits parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('DETR stack scoring binary mask parity exceeds tolerance');
    } else if (packetMode === 'mlx-detr-stack-export') {
      if (!lastState.tensorPacket?.encoderSrcSha256 || !lastState.tensorPacket?.encoderPosSha256 || !lastState.tensorPacket?.expectedEncoderHiddenStatesSha256 || !lastState.tensorPacket?.expectedLastHsSha256 || !lastState.tensorPacket?.expectedReferenceBoxesSha256 || !lastState.tensorPacket?.expectedPresenceLogitsSha256 || !lastState.tensorPacket?.pixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('DETR stack tensorPacket identity missing');
      }
      if (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 3) {
        throw new Error('DETR stack composition receipt chain missing');
      }
      const [encoderReceipt, decoderReceipt, tailReceipt] = lastState.compositionRouteReceipts;
      const compositionEdge = lastState.compositionEdge;
      if (encoderReceipt.effectiveRouteId !== DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack encoder receipt identity mismatch');
      if (decoderReceipt.effectiveRouteId !== DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack decoder receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack mask-tail receipt identity mismatch');
      const encoderOutput = encoderReceipt.outputs?.find(output => output.role === 'encoder-hidden-states');
      if (
        encoderOutput?.artifactId !== compositionEdge?.detrEncoderOutput?.artifactId
        || encoderOutput?.sha256 !== compositionEdge?.detrEncoderOutput?.sha256
        || JSON.stringify(encoderOutput?.shape) !== JSON.stringify(compositionEdge?.detrEncoderOutput?.shape)
      ) {
        throw new Error('DETR stack encoder output identity does not match composition edge');
      }
      const decoderTensorInput = decoderReceipt.inputs?.find(input => input.role === 'sam3-detr-decoder-tensors');
      if (decoderTensorInput?.sha256 !== compositionEdge?.decoderTensorSha256) throw new Error('DETR stack decoderTensorSha256 does not match decoder receipt input');
      const lastHsOutput = decoderReceipt.outputs?.find(output => output.role === 'last-hs');
      const referenceBoxesOutput = decoderReceipt.outputs?.find(output => output.role === 'reference-boxes');
      const presenceLogitsOutput = decoderReceipt.outputs?.find(output => output.role === 'presence-logits');
      if (
        lastHsOutput?.artifactId !== compositionEdge?.lastHsOutput?.artifactId
        || lastHsOutput?.sha256 !== compositionEdge?.lastHsOutput?.sha256
        || JSON.stringify(lastHsOutput?.shape) !== JSON.stringify(compositionEdge?.lastHsOutput?.shape)
      ) {
        throw new Error('DETR stack last-hs output identity does not match composition edge');
      }
      if (
        referenceBoxesOutput?.artifactId !== compositionEdge?.referenceBoxesOutput?.artifactId
        || referenceBoxesOutput?.sha256 !== compositionEdge?.referenceBoxesOutput?.sha256
      ) {
        throw new Error('DETR stack reference-boxes output identity does not match composition edge');
      }
      if (
        presenceLogitsOutput?.artifactId !== compositionEdge?.presenceLogitsOutput?.artifactId
        || presenceLogitsOutput?.sha256 !== compositionEdge?.presenceLogitsOutput?.sha256
      ) {
        throw new Error('DETR stack presence-logits output identity does not match composition edge');
      }
      const downstreamTensorInput = tailReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('DETR stack downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.encoderHiddenStatesMaxAbsDiff > 0.0003) throw new Error('DETR stack encoder parity exceeds tolerance');
      if (lastState.parity?.lastHsMaxAbsDiff > 0.0006) throw new Error('DETR stack last-hs parity exceeds tolerance');
      if (lastState.parity?.referenceBoxesMaxAbsDiff > 0.0006) throw new Error('DETR stack reference-box parity exceeds tolerance');
      if (lastState.parity?.presenceLogitsMaxAbsDiff > 0.0006) throw new Error('DETR stack presence parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('DETR stack binary mask parity exceeds tolerance');
    } else if (requestedRouteId === DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.encoderHiddenStatesSha256 || !lastState.tensorPacket?.encoderPosSha256 || !lastState.tensorPacket?.expectedLastHsSha256 || !lastState.tensorPacket?.expectedReferenceBoxesSha256 || !lastState.tensorPacket?.expectedPresenceLogitsSha256 || !lastState.tensorPacket?.pixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('DETR decoder tensorPacket identity missing');
      }
      if (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 2) {
        throw new Error('DETR decoder composition receipt chain missing');
      }
      const [decoderReceipt, tailReceipt] = lastState.compositionRouteReceipts;
      const compositionEdge = lastState.compositionEdge;
      if (decoderReceipt.effectiveRouteId !== DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR decoder receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR decoder mask-tail receipt identity mismatch');
      const lastHsOutput = decoderReceipt.outputs?.find(output => output.role === 'last-hs');
      const referenceBoxesOutput = decoderReceipt.outputs?.find(output => output.role === 'reference-boxes');
      const presenceLogitsOutput = decoderReceipt.outputs?.find(output => output.role === 'presence-logits');
      if (
        lastHsOutput?.artifactId !== compositionEdge?.lastHsOutput?.artifactId
        || lastHsOutput?.sha256 !== compositionEdge?.lastHsOutput?.sha256
        || JSON.stringify(lastHsOutput?.shape) !== JSON.stringify(compositionEdge?.lastHsOutput?.shape)
      ) {
        throw new Error('DETR decoder last-hs output identity does not match composition edge');
      }
      if (
        referenceBoxesOutput?.artifactId !== compositionEdge?.referenceBoxesOutput?.artifactId
        || referenceBoxesOutput?.sha256 !== compositionEdge?.referenceBoxesOutput?.sha256
      ) {
        throw new Error('DETR decoder reference-boxes output identity does not match composition edge');
      }
      if (
        presenceLogitsOutput?.artifactId !== compositionEdge?.presenceLogitsOutput?.artifactId
        || presenceLogitsOutput?.sha256 !== compositionEdge?.presenceLogitsOutput?.sha256
      ) {
        throw new Error('DETR decoder presence-logits output identity does not match composition edge');
      }
      const downstreamTensorInput = tailReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('DETR decoder downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.lastHsMaxAbsDiff > 0.0006) throw new Error('DETR decoder last-hs parity exceeds tolerance');
      if (lastState.parity?.referenceBoxesMaxAbsDiff > 0.0006) throw new Error('DETR decoder reference-box parity exceeds tolerance');
      if (lastState.parity?.presenceLogitsMaxAbsDiff > 0.0006) throw new Error('DETR decoder presence parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('DETR decoder binary mask parity exceeds tolerance');
    } else if (requestedRouteId === DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.encoderSrcSha256 || !lastState.tensorPacket?.encoderPosSha256 || !lastState.tensorPacket?.expectedEncoderHiddenStatesSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('DETR encoder tensorPacket identity missing');
      }
      if (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 4) {
        throw new Error('DETR encoder composition receipt chain missing');
      }
      const [detrReceipt, promptReceipt, pixelReceipt, tailReceipt] = lastState.compositionRouteReceipts;
      const compositionEdge = lastState.compositionEdge;
      if (detrReceipt.effectiveRouteId !== DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR receipt identity mismatch');
      if (promptReceipt.effectiveRouteId !== PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR prompt-FPN receipt identity mismatch');
      if (pixelReceipt.effectiveRouteId !== PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR pixel receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR mask-tail receipt identity mismatch');
      const encoderOutput = detrReceipt.outputs?.find(output => output.role === 'encoder-hidden-states');
      if (
        encoderOutput?.artifactId !== compositionEdge?.encoderHiddenStatesOutput?.artifactId
        || encoderOutput?.sha256 !== compositionEdge?.encoderHiddenStatesOutput?.sha256
        || JSON.stringify(encoderOutput?.shape) !== JSON.stringify(compositionEdge?.encoderHiddenStatesOutput?.shape)
      ) {
        throw new Error('DETR encoder output identity does not match composition edge');
      }
      const promptTensorInput = promptReceipt.inputs?.find(input => input.role === 'sam3-prompt-fpn-tensors');
      if (promptTensorInput?.sha256 !== compositionEdge?.encoderTensorSha256) throw new Error('DETR encoderTensorSha256 does not match prompt-FPN receipt input');
      const pixelTensorInput = pixelReceipt.inputs?.find(input => input.role === 'sam3-pixel-decoder-tensors');
      if (pixelTensorInput?.sha256 !== compositionEdge?.pixelTensorSha256) throw new Error('DETR pixelTensorSha256 does not match pixel receipt input');
      const downstreamTensorInput = tailReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('DETR downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.encoderHiddenStatesMaxAbsDiff > 0.0003) throw new Error('DETR encoder parity exceeds tolerance');
      if (lastState.parity?.promptFpnMaxAbsDiff > 0.0003) throw new Error('DETR prompt-FPN parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('DETR binary mask parity exceeds tolerance');
    } else if (requestedRouteId === PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.encoderHiddenStatesSha256 || !lastState.tensorPacket?.expectedPromptFpnFeatureSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('prompt-FPN tensorPacket identity missing');
      }
      const midstreamRouteReceipt = lastState.midstreamRouteReceipt;
      const downstreamRouteReceipt = lastState.downstreamRouteReceipt;
      const compositionEdge = lastState.compositionEdge;
      if (!midstreamRouteReceipt) throw new Error('prompt-FPN midstream pixel route receipt missing');
      if (!downstreamRouteReceipt) throw new Error('prompt-FPN downstream mask-tail route receipt missing');
      if (midstreamRouteReceipt.effectiveRouteId !== PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('prompt-FPN midstream route identity mismatch');
      const pixelTensorInput = midstreamRouteReceipt.inputs?.find(input => input.role === 'sam3-pixel-decoder-tensors');
      if (pixelTensorInput?.sha256 !== compositionEdge?.pixelTensorSha256) throw new Error('prompt-FPN pixelTensorSha256 does not match midstream receipt input');
      const pixelEmbedOutput = midstreamRouteReceipt.outputs?.find(output => output.role === 'pixel-embed');
      if (
        pixelEmbedOutput?.artifactId !== compositionEdge?.pixelEmbedOutput?.artifactId
        || pixelEmbedOutput?.sha256 !== compositionEdge?.pixelEmbedOutput?.sha256
        || JSON.stringify(pixelEmbedOutput?.shape) !== JSON.stringify(compositionEdge?.pixelEmbedOutput?.shape)
      ) {
        throw new Error('prompt-FPN pixel output identity does not match midstream receipt output');
      }
      const downstreamTensorInput = downstreamRouteReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('prompt-FPN downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.promptFpnMaxAbsDiff > 0.0003) throw new Error('prompt-FPN parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('prompt-FPN binary mask parity exceeds tolerance');
    } else if (requestedRouteId === PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.fpnFeatureSha256 || !lastState.tensorPacket?.expectedPixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('pixel-decoder tensorPacket identity missing');
      }
      if (lastState.parity?.pixelEmbedMaxAbsDiff > 0.0002) throw new Error('pixel embed parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 4) throw new Error('pixel decoder binary mask parity exceeds tolerance');
    } else if (requestedRouteId === MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.lastHsSha256 || !lastState.tensorPacket?.pixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('mask-tail tensorPacket identity missing');
      }
      if (lastState.parity?.binaryMismatchCount !== 0) throw new Error('binary mask parity mismatch');
    } else if (lastState.parity?.binaryMismatchCount !== 0) {
      throw new Error('binary mask parity mismatch');
    } else if (!lastState.tensorPacket?.hyperInputSha256) {
      throw new Error('tensorPacket identity missing');
    }
    if (lastState.parity?.maskLogitsMaxAbsDiff > manifestTolerance('webGpuLogitsMaxAbsDiff', 0.0001)) throw new Error('mask logits parity exceeds tolerance');
    if (lastState.claims?.fullSam3BrowserExecution !== false) throw new Error('smoke overclaimed full SAM3 browser execution');

    phase = 'capture_screenshot';
    await delay(settleMs);
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
    primaryOutputWritten = true;

    phase = 'write_report';
    writeReport({
      ok: true,
      failure_phase: null,
    });
    await ws.close?.();
  } catch (error) {
    const failurePhase = error?.failurePhase || phase;
    phase = failurePhase;
    writeReport({
      ok: false,
      failure_phase: failurePhase,
      error: String(error?.stack || error?.message || error),
    });
    throw error;
  } finally {
    if (chromeProcess) chromeProcess.kill('SIGTERM');
    if (server) server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
