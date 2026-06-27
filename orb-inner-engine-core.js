import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export const ORB_INNER_ENGINE_IDENTITY = 'orb-inner-engine-witness-v0';
export const ORB_INNER_ENGINE_GUIDE_SUBSTRATE_IDENTITY = 'orb-inner-engine-guide-substrate-v0';
export const ORB_INNER_ENGINE_GENERATED_SUBSTRATE_IDENTITY = 'orb-inner-engine-generated-substrate-v1';

const TAU = Math.PI * 2;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function angularDistance(a, b) {
  let d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
}

function ringBand(radius, center, width) {
  return 1 - smoothstep(width * 0.45, width, Math.abs(radius - center));
}

function makeSeedProfile(seed) {
  const seedHash = hashString(seed);
  const random = mulberry32(seedHash);
  const ringJitter = Array.from({ length: 7 }, () => (random() - 0.5) * 0.018);
  const ribPhase = random() * TAU;
  const occluderPhase = random() * TAU;
  const heatPhase = random() * TAU;
  return { seedHash, ringJitter, ribPhase, occluderPhase, heatPhase };
}

function sampleGuideSubstrate(nx, ny, profile) {
  const r = Math.hypot(nx, ny);
  const theta = Math.atan2(ny, nx);
  if (r > 1.02) {
    return { ring: 0, rib: 0, occluder: 0, channel: 0, hotCenter: 0, darkRim: 0, strength: 0 };
  }

  const guideRingCenters = [0.24, 0.34, 0.46, 0.58, 0.7, 0.82, 0.92];
  let ring = 0;
  for (let i = 0; i < guideRingCenters.length; i++) {
    const arcBreak = 0.72 + 0.28 * smoothstep(-0.28, 0.82, Math.sin(theta * (4 + i) + profile.occluderPhase - r * 6.5));
    ring = Math.max(ring, ringBand(r, guideRingCenters[i] + profile.ringJitter[i] * 0.5, 0.015 + i * 0.002) * arcBreak);
  }

  const ribWave = Math.cos(theta * 18 + profile.ribPhase);
  const rib = Math.pow(clamp((ribWave - 0.62) / 0.38), 1.45)
    * smoothstep(0.24, 0.36, r)
    * (1 - smoothstep(0.88, 0.99, r));

  const occluderWave = Math.cos(theta * 10 + profile.occluderPhase + Math.sin(r * 4.5));
  const occluder = Math.pow(clamp((occluderWave - 0.16) / 0.84), 1.12)
    * smoothstep(0.46, 0.58, r)
    * (1 - smoothstep(0.86, 0.96, r));

  const shutterBlade = Math.max(
    0,
    1 - smoothstep(0.018, 0.05, Math.abs(Math.sin(theta * 5 + r * 3.6 + profile.occluderPhase))),
  ) * smoothstep(0.52, 0.64, r) * (1 - smoothstep(0.9, 0.98, r));

  const channelWave = Math.cos(theta * 9 - profile.ribPhase * 0.5 + r * 5.2);
  const channel = Math.pow(clamp((channelWave - 0.5) / 0.5), 1.35)
    * smoothstep(0.2, 0.34, r)
    * (1 - smoothstep(0.78, 0.92, r));

  const hotCenter = 1 - smoothstep(0.105, 0.19, r);
  const darkRim = smoothstep(0.72, 0.97, r);
  const finalOccluder = Math.max(occluder, shutterBlade);
  return {
    ring,
    rib,
    occluder: finalOccluder,
    channel,
    hotCenter,
    darkRim,
    strength: Math.max(ring, rib, finalOccluder, channel, hotCenter * 0.7),
  };
}

function sampleGeneratedSubstrate(nx, ny, profile) {
  const r = Math.hypot(nx, ny);
  const theta = Math.atan2(ny, nx);
  if (r > 1.04) {
    return {
      dirtyPlate: 0,
      underlightChannel: 0,
      apertureWindow: 0,
      materialPitting: 0,
      rimLip: 0,
      strength: 0,
    };
  }

  const offAxisWindow = smoothstep(-0.92, 0.46, nx * 0.98 - ny * 0.24 + 0.18)
    * (1 - smoothstep(0.88, 1.1, r))
    * smoothstep(0.18, 0.34, r);
  const lipShadow = Math.max(
    ringBand(r, 0.82, 0.055),
    smoothstep(0.62, 0.96, r) * smoothstep(-0.2, 0.82, -nx * 0.72 + ny * 0.18 + 0.42),
  );
  const plateWave = Math.cos(theta * 9 + profile.occluderPhase + Math.sin(r * 5.6) * 0.55);
  const broadPlate = Math.pow(clamp((plateWave - 0.08) / 0.92), 1.28)
    * smoothstep(0.22, 0.4, r)
    * (1 - smoothstep(0.9, 1.02, r));
  const shutterPlate = Math.max(
    0,
    1 - smoothstep(0.035, 0.12, Math.abs(Math.sin(theta * 4.5 + r * 2.8 + profile.ribPhase))),
  ) * smoothstep(0.28, 0.48, r) * (1 - smoothstep(0.86, 0.98, r));
  const dirtyPlate = clamp(Math.max(broadPlate * 0.85, shutterPlate) * (0.42 + 0.58 * offAxisWindow) + lipShadow * 0.44);

  const slotWave = Math.cos(theta * 9 + profile.ribPhase * 0.6 - r * 5.2);
  const radialSlot = Math.pow(clamp((slotWave - 0.7) / 0.3), 2.1)
    * smoothstep(0.26, 0.44, r)
    * (1 - smoothstep(0.82, 0.96, r));
  const plateEdgeSlot = Math.max(
    0,
    1 - smoothstep(0.018, 0.06, Math.abs(Math.sin(theta * 4.5 + r * 2.8 + profile.ribPhase)) - 0.16),
  ) * smoothstep(0.34, 0.52, r) * (1 - smoothstep(0.88, 1.0, r));
  const underlightChannel = clamp(Math.max(radialSlot, plateEdgeSlot * 0.7) * (0.36 + 0.64 * offAxisWindow) * (1 - dirtyPlate * 0.34));

  const pittingNoise = 0.5 + 0.5 * Math.sin(nx * 83 + Math.sin(ny * 31 + profile.heatPhase) * 3.4 + profile.seedHash * 0.00007);
  const pittingBreakup = 0.5 + 0.5 * Math.sin(nx * 37 - ny * 59 + profile.occluderPhase);
  const materialPitting = clamp(Math.pow(pittingNoise, 4.2) * smoothstep(0.22, 0.54, dirtyPlate + lipShadow) + pittingBreakup * 0.12 * dirtyPlate);
  const apertureWindow = clamp(offAxisWindow * (1 - smoothstep(0.94, 1.04, r)) + lipShadow * 0.34);
  const rimLip = clamp(lipShadow);
  return {
    dirtyPlate,
    underlightChannel,
    apertureWindow,
    materialPitting,
    rimLip,
    strength: Math.max(dirtyPlate, underlightChannel, apertureWindow * 0.72),
  };
}

export function createOrbInnerEngineGuideSubstrate({
  seed = 'molten-heartfucker-core-v0',
  width = 640,
  height = 640,
} = {}) {
  const profile = makeSeedProfile(seed);
  const counts = {
    guideRingPixels: 0,
    guideRibPixels: 0,
    guideOccluderPixels: 0,
    guideChannelPixels: 0,
    guideHotCenterPixels: 0,
  };
  const scale = 2 / Math.min(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - width / 2) * scale;
      const ny = (y + 0.5 - height / 2) * scale;
      const guide = sampleGuideSubstrate(nx, ny, profile);
      if (guide.ring > 0.34) counts.guideRingPixels++;
      if (guide.rib > 0.28) counts.guideRibPixels++;
      if (guide.occluder > 0.32) counts.guideOccluderPixels++;
      if (guide.channel > 0.3) counts.guideChannelPixels++;
      if (guide.hotCenter > 0.5) counts.guideHotCenterPixels++;
    }
  }
  return {
    identity: ORB_INNER_ENGINE_GUIDE_SUBSTRATE_IDENTITY,
    seed,
    width,
    height,
    metrics: counts,
    fields: ['ring', 'rib', 'occluder', 'channel', 'hotCenter', 'darkRim'],
    sample(nx, ny) {
      return sampleGuideSubstrate(nx, ny, profile);
    },
  };
}

export function createOrbInnerEngineGeneratedSubstrate({
  seed = 'molten-heartfucker-core-v0',
  width = 640,
  height = 640,
  profile: substrateProfile = 'molten-flux-crop-v1',
} = {}) {
  const profile = makeSeedProfile(seed);
  const counts = {
    dirtyPlatePixels: 0,
    underlightChannelPixels: 0,
    apertureWindowPixels: 0,
    materialPittingPixels: 0,
  };
  const scale = 2 / Math.min(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - width / 2) * scale;
      const ny = (y + 0.5 - height / 2) * scale;
      const generated = sampleGeneratedSubstrate(nx, ny, profile);
      if (generated.dirtyPlate > 0.34) counts.dirtyPlatePixels++;
      if (generated.underlightChannel > 0.18) counts.underlightChannelPixels++;
      if (generated.apertureWindow > 0.32) counts.apertureWindowPixels++;
      if (generated.materialPitting > 0.18) counts.materialPittingPixels++;
    }
  }
  return {
    identity: ORB_INNER_ENGINE_GENERATED_SUBSTRATE_IDENTITY,
    seed,
    width,
    height,
    profile: substrateProfile,
    metrics: counts,
    fields: ['dirtyPlate', 'underlightChannel', 'apertureWindow', 'materialPitting', 'rimLip'],
    references: [
      {
        role: 'best composition substrate',
        id: 'flux-v1-off-axis-inner-wall-a',
        path: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-evil-orb-inner-engine-flux-crop-v1-20260626T234217Z/review/flux-v1-off-axis-inner-wall-a.png',
      },
      {
        role: 'best dirty black-plate / underlight material substrate',
        id: 'flux-v1-rib-edge-material-transfer-a',
        path: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-evil-orb-inner-engine-flux-crop-v1-20260626T234217Z/review/flux-v1-rib-edge-material-transfer-a.png',
      },
      {
        role: 'best molten channel/rim material substrate',
        id: 'flux-v1-channel-material-transfer-a',
        path: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-evil-orb-inner-engine-flux-crop-v1-20260626T234217Z/review/flux-v1-channel-material-transfer-a.png',
      },
    ],
    sample(nx, ny) {
      return sampleGeneratedSubstrate(nx, ny, profile);
    },
  };
}

export function createOrbInnerEngineCore({
  seed = 'molten-heartfucker-core-v0',
  socketRadius = 1,
  animationPhase = 0,
} = {}) {
  const profile = makeSeedProfile(seed);
  const heatCadenceHz = 0.72 + ((profile.seedHash >>> 3) % 17) / 100;
  const cadence = 0.5 + 0.5 * Math.sin((animationPhase * TAU) + profile.heatPhase);
  return {
    identity: ORB_INNER_ENGINE_IDENTITY,
    seed,
    seedHash: profile.seedHash,
    socket: {
      radius: socketRadius,
      transform: {
        space: 'lamellar-core-socket-local',
        translation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [socketRadius, socketRadius, socketRadius],
      },
    },
    material: {
      emissiveField: {
        hotCenterGain: 3.4 + cadence * 0.35,
        channelGain: 1.35,
        ringGain: 0.92,
        emberGain: 0.52,
        colorRamp: ['#160805', '#5a1607', '#d75a12', '#ffb13a', '#fff0b2'],
      },
      occlusion: {
        shellOcclusion: 0.62,
        innerExposure: 0.58,
        darkRimFalloff: 2.35,
        occluderHardness: 0.78,
      },
    },
    volumetric: {
      mode: 'software-emissive-field-v0',
      heatCadenceHz,
      turbulentEnergy: 0.38,
      flameNoiseScale: 8.5,
      containedPressure: 0.71,
    },
    lightSpill: {
      apertureTransmission: 0.44,
      rimCatch: 0.58,
      lipProximityGain: 0.42,
      spillColor: [255, 116, 24],
      falloffExponent: 2.1,
    },
    generatedSubstrate: {
      identity: ORB_INNER_ENGINE_GENERATED_SUBSTRATE_IDENTITY,
      profile: 'molten-flux-crop-v1',
      interpretation: 'procedural controls distilled from v1 FLUX crop campaign: off-axis aperture-window layout, dirty black plate material, bounded orange underlight channels.',
    },
  };
}

function renderCorePixel(nx, ny, profile, animationPhase, apertureMode = false, guideSample = null, generatedSample = null) {
  const r = Math.hypot(nx, ny);
  const theta = Math.atan2(ny, nx);
  const disk = 1 - smoothstep(0.96, 1.03, r);
  if (disk <= 0) {
    return {
      rgba: [3, 4, 6, 255],
      feature: {
        hotCenter: 0,
        radialRib: 0,
        nestedRing: 0,
        occluder: 0,
        orangeChannel: 0,
        guideSubstrate: 0,
        guideChannel: 0,
        guideOccluder: 0,
        generatedSubstrate: 0,
        dirtyPlate: 0,
        underlightChannel: 0,
        apertureWindow: 0,
      },
      luma: 4,
    };
  }

  const radialVoid = smoothstep(0.18, 0.72, r);
  const guide = guideSample || { ring: 0, rib: 0, occluder: 0, channel: 0, hotCenter: 0, darkRim: 0, strength: 0 };
  const generated = generatedSample || { dirtyPlate: 0, underlightChannel: 0, apertureWindow: 0, materialPitting: 0, rimLip: 0, strength: 0 };
  let darkRim = smoothstep(0.58, 0.98, r);
  let centerHeat = Math.exp(-Math.pow(r / 0.112, 2.45));
  const innerCore = Math.exp(-Math.pow(r / 0.24, 3.0)) * (1 - generated.dirtyPlate * 0.32);
  const heatBeat = 0.88 + 0.12 * Math.sin(animationPhase * TAU + profile.heatPhase + r * 9.0);

  let nestedRing = 0;
  const ringCenters = [0.24, 0.34, 0.46, 0.58, 0.69, 0.79, 0.88];
  for (let i = 0; i < ringCenters.length; i++) {
    const wobble = 0.012 * Math.sin(theta * (i + 2) + profile.ribPhase + i * 1.7);
    const brokenArc = 0.76 + 0.24 * smoothstep(-0.35, 0.85, Math.sin(theta * (5 + i) - r * 8.0 + profile.occluderPhase));
    nestedRing = Math.max(nestedRing, ringBand(r, ringCenters[i] + profile.ringJitter[i] + wobble, 0.018 + i * 0.003) * brokenArc);
  }

  const centerIrisRing = Math.max(
    ringBand(r, 0.105, 0.012),
    ringBand(r, 0.165, 0.014),
    ringBand(r, 0.235, 0.018),
  );
  const centerIrisSpoke = Math.pow(clamp((Math.cos(theta * 12 + profile.ribPhase * 1.7) - 0.46) / 0.54), 1.35)
    * smoothstep(0.055, 0.105, r)
    * (1 - smoothstep(0.24, 0.32, r));

  const ribCount = 18;
  const ribWave = Math.cos(theta * ribCount + profile.ribPhase + Math.sin(r * 12) * 0.25);
  let radialRib = Math.pow(clamp((ribWave - 0.78) / 0.22), 2.2) * smoothstep(0.25, 0.42, r) * (1 - smoothstep(0.9, 1.0, r));

  const channelWave = Math.cos(theta * 9 - profile.ribPhase * 0.7 + r * 7.4);
  let orangeChannel = Math.pow(clamp((channelWave - 0.58) / 0.42), 1.7) * smoothstep(0.18, 0.36, r) * (1 - smoothstep(0.84, 0.97, r));

  const occluderSlots = 10;
  const occluderWave = Math.cos(theta * occluderSlots + profile.occluderPhase + Math.sin(r * 8.5));
  let occluder = Math.pow(clamp((occluderWave - 0.34) / 0.66), 1.15) * smoothstep(0.42, 0.56, r) * (1 - smoothstep(0.83, 0.94, r));
  nestedRing = Math.max(nestedRing, guide.ring * 0.58);
  radialRib = Math.max(radialRib, guide.rib * 0.92);
  orangeChannel = Math.max(orangeChannel, guide.channel * 0.62, generated.underlightChannel * 1.08);
  occluder = Math.max(occluder, guide.occluder * 1.05, generated.dirtyPlate * 1.06);
  centerHeat = Math.max(centerHeat, guide.hotCenter * 0.28);
  darkRim = Math.max(darkRim, guide.darkRim * 0.96, generated.rimLip * 0.8);

  const diagonalBrace = Math.max(
    0,
    1 - smoothstep(0.018, 0.052, Math.abs(Math.sin(theta * 3 + r * 5.8 + profile.occluderPhase))),
  ) * smoothstep(0.36, 0.5, r) * (1 - smoothstep(0.72, 0.88, r));
  const sootPocket = smoothstep(0.28, 0.52, r)
    * (1 - smoothstep(0.88, 0.99, r))
    * smoothstep(0.15, 0.88, 0.5 + 0.5 * Math.sin(theta * 7.0 + r * 19.0 + profile.heatPhase))
    * smoothstep(0.2, 0.82, 0.5 + 0.5 * Math.sin(theta * 13.0 - r * 11.0 + profile.occluderPhase));

  const materialScratch = generated.materialPitting * (0.44 + 0.56 * generated.dirtyPlate);
  const centralOccluder = centerIrisSpoke * 0.82 + ringBand(r, 0.212, 0.01) * 0.58 + ringBand(r, 0.142, 0.018) * 0.46;
  const mechanicalDark = clamp(0.92 * occluder + 0.54 * radialRib + 0.44 * diagonalBrace + 0.82 * darkRim + 0.38 * sootPocket + centralOccluder + generated.dirtyPlate * 0.46 + materialScratch * 0.28);
  const ringEmission = (nestedRing + centerIrisRing * 0.42) * (0.12 + 0.24 * orangeChannel) * (1 - generated.dirtyPlate * 0.42);
  const channelEmission = clamp(orangeChannel * (0.42 + 0.18 * Math.sin(animationPhase * TAU + r * 17)) + generated.underlightChannel * 0.38);
  const heat = clamp((centerHeat * 2.9 + innerCore * 0.48 + ringEmission + channelEmission * 0.82) * heatBeat);
  const ember = clamp(Math.sin(theta * 26 + r * 41 + profile.seedHash * 0.00003) * 0.5 + 0.5) * orangeChannel * radialVoid;

  let red = 10 + 168 * heat + 78 * channelEmission + 32 * nestedRing + 28 * ember;
  let green = 7 + 82 * heat + 36 * channelEmission + 12 * nestedRing;
  let blue = 6 + 14 * heat + 5 * nestedRing;

  const metal = 16 + 28 * nestedRing + 38 * radialRib + 24 * diagonalBrace + 18 * generated.dirtyPlate - 16 * materialScratch;
  red += metal;
  green += metal * 0.72;
  blue += metal * 0.52;

  const occlusion = clamp(0.3 + mechanicalDark * 1.18 + generated.rimLip * 0.2);
  red *= 1 - occlusion * (0.55 + 0.2 * darkRim);
  green *= 1 - occlusion * (0.64 + 0.18 * darkRim);
  blue *= 1 - occlusion * (0.72 + 0.16 * darkRim);
  const outerRimAttenuation = 1 - smoothstep(0.66, 0.96, r) * (0.84 + generated.rimLip * 0.16);
  red *= outerRimAttenuation;
  green *= outerRimAttenuation;
  blue *= outerRimAttenuation;

  if (apertureMode) {
    red *= 0.96;
    green *= 0.94;
    blue *= 0.92;
  }

  red = clamp(red, 0, 255);
  green = clamp(green, 0, 255);
  blue = clamp(blue, 0, 255);
  const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

  return {
    rgba: [red, green, blue, 255],
    feature: {
      hotCenter: centerHeat > 0.48 && heat > 0.45 ? 1 : 0,
      radialRib: radialRib > 0.22 ? 1 : 0,
      nestedRing: nestedRing > 0.34 ? 1 : 0,
      occluder: occluder > 0.36 || diagonalBrace > 0.45 || centralOccluder > 0.28 ? 1 : 0,
      orangeChannel: channelEmission > 0.26 && r > 0.18 ? 1 : 0,
      guideSubstrate: guide.strength > 0.32 ? 1 : 0,
      guideChannel: guide.channel > 0.3 ? 1 : 0,
      guideOccluder: guide.occluder > 0.32 ? 1 : 0,
      generatedSubstrate: generated.strength > 0.32 ? 1 : 0,
      dirtyPlate: generated.dirtyPlate > 0.34 ? 1 : 0,
      underlightChannel: generated.underlightChannel > 0.18 ? 1 : 0,
      apertureWindow: generated.apertureWindow > 0.32 ? 1 : 0,
    },
    luma,
    radius: r,
  };
}

function finalMetrics(width, height, counts, lumaCenter, lumaRim, diskPixels) {
  const structure = (counts.radialRibPixels + counts.nestedRingPixels + counts.occluderPixels) / Math.max(1, diskPixels);
  return {
    ...counts,
    darkRimContrast: clamp((lumaCenter.mean - lumaRim.mean) / 255, 0, 1),
    flatGlowScore: clamp(0.78 - structure * 1.6 - counts.orangeChannelPixels / Math.max(1, diskPixels) * 0.42, 0.18, 0.95),
    diskPixels,
    width,
    height,
  };
}

function makeLumaAccumulator() {
  return {
    sum: 0,
    count: 0,
    get mean() {
      return this.count ? this.sum / this.count : 0;
    },
    add(value) {
      this.sum += value;
      this.count++;
    },
  };
}

export function renderOrbInnerEngineFrame({
  width = 640,
  height = 640,
  seed = 'molten-heartfucker-core-v0',
  animationPhase = 0,
  guideSubstrate = null,
  generatedSubstrate = null,
} = {}) {
  const profile = makeSeedProfile(seed);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const counts = {
    hotCenterPixels: 0,
    radialRibPixels: 0,
    nestedRingPixels: 0,
    occluderPixels: 0,
    orangeChannelPixels: 0,
    guideSubstratePixels: 0,
    guideChannelPixels: 0,
    guideOccluderPixels: 0,
    generatedSubstratePixels: 0,
    dirtyPlatePixels: 0,
    underlightChannelPixels: 0,
    apertureWindowPixels: 0,
  };
  const lumaCenter = makeLumaAccumulator();
  const lumaRim = makeLumaAccumulator();
  let diskPixels = 0;
  const scale = 2 / Math.min(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - width / 2) * scale;
      const ny = (y + 0.5 - height / 2) * scale;
      const sample = renderCorePixel(
        nx,
        ny,
        profile,
        animationPhase,
        false,
        guideSubstrate?.sample?.(nx, ny),
        generatedSubstrate?.sample?.(nx, ny),
      );
      const i = (y * width + x) * 4;
      rgba[i] = sample.rgba[0];
      rgba[i + 1] = sample.rgba[1];
      rgba[i + 2] = sample.rgba[2];
      rgba[i + 3] = sample.rgba[3];
      if (sample.radius <= 0.98) {
        diskPixels++;
        if (sample.radius < 0.28) lumaCenter.add(sample.luma);
        if (sample.radius > 0.72 && sample.radius < 0.95) lumaRim.add(sample.luma);
      }
      if (sample.feature.hotCenter) counts.hotCenterPixels++;
      if (sample.feature.radialRib) counts.radialRibPixels++;
      if (sample.feature.nestedRing) counts.nestedRingPixels++;
      if (sample.feature.occluder) counts.occluderPixels++;
      if (sample.feature.orangeChannel) counts.orangeChannelPixels++;
      if (sample.feature.guideSubstrate) counts.guideSubstratePixels++;
      if (sample.feature.guideChannel) counts.guideChannelPixels++;
      if (sample.feature.guideOccluder) counts.guideOccluderPixels++;
      if (sample.feature.generatedSubstrate) counts.generatedSubstratePixels++;
      if (sample.feature.dirtyPlate) counts.dirtyPlatePixels++;
      if (sample.feature.underlightChannel) counts.underlightChannelPixels++;
      if (sample.feature.apertureWindow) counts.apertureWindowPixels++;
    }
  }
  return {
    identity: ORB_INNER_ENGINE_IDENTITY,
    width,
    height,
    seed,
    rgba,
    metrics: finalMetrics(width, height, counts, lumaCenter, lumaRim, diskPixels),
  };
}

function apertureMask(nx, ny, profile, apertureOpen) {
  const r = Math.hypot(nx, ny);
  if (r > 1.02) return { open: 0, rim: 0, shell: 0 };
  const theta = Math.atan2(ny, nx);
  const central = 1 - smoothstep(0.1 + apertureOpen * 0.018, 0.17 + apertureOpen * 0.035, r);
  const slotCount = 6;
  let slot = 0;
  let rim = 0;
  for (let i = 0; i < slotCount; i++) {
    const angle = (i / slotCount) * TAU + profile.ribPhase * 0.16;
    const d = angularDistance(theta, angle);
    const width = 0.04 + apertureOpen * 0.04;
    const radialWindow = smoothstep(0.28, 0.42, r) * (1 - smoothstep(0.82, 0.94, r));
    const irregularOpen = 0.72 + 0.28 * smoothstep(-0.6, 0.9, Math.sin(i * 1.73 + profile.occluderPhase));
    const slotOpen = (1 - smoothstep(width, width * 1.55, d)) * radialWindow * irregularOpen;
    slot = Math.max(slot, slotOpen);
    const rimBand = (1 - smoothstep(width * 1.05, width * 2.2, Math.abs(d - width))) * radialWindow;
    rim = Math.max(rim, rimBand);
  }
  const open = clamp(Math.max(central, slot) * smoothstep(0.08, 0.18, apertureOpen));
  return {
    open,
    rim: clamp(Math.max(rim, ringBand(r, 0.31, 0.018) * 0.75, ringBand(r, 0.84, 0.018) * 0.55)),
    shell: r <= 1 ? 1 : 0,
  };
}

export function renderOrbApertureProxyFrame({
  width = 640,
  height = 640,
  seed = 'molten-heartfucker-core-v0',
  animationPhase = 0,
  apertureOpen = 0.58,
  generatedSubstrate = null,
} = {}) {
  const profile = makeSeedProfile(seed);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const counts = {
    hotCenterPixels: 0,
    radialRibPixels: 0,
    nestedRingPixels: 0,
    occluderPixels: 0,
    orangeChannelPixels: 0,
    visibleCorePixels: 0,
    shellOccludedPixels: 0,
    rimLightCatchPixels: 0,
    generatedSubstratePixels: 0,
    dirtyPlatePixels: 0,
    underlightChannelPixels: 0,
    apertureWindowPixels: 0,
  };
  const lumaCenter = makeLumaAccumulator();
  const lumaRim = makeLumaAccumulator();
  let diskPixels = 0;
  const scale = 2 / Math.min(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - width / 2) * scale;
      const ny = (y + 0.5 - height / 2) * scale;
      const generatedSample = generatedSubstrate?.sample?.(nx, ny);
      const core = renderCorePixel(nx, ny, profile, animationPhase, true, null, generatedSample);
      const mask = apertureMask(nx, ny, profile, apertureOpen);
      const r = Math.hypot(nx, ny);
      const apertureBias = generatedSample?.apertureWindow || 0;
      const biasedOpen = clamp(mask.open * (0.62 + apertureBias * 0.24));
      const shellMatter = clamp(mask.shell * (1 - biasedOpen));
      const rimLight = Math.max(mask.rim, (generatedSample?.rimLip || 0) * 0.28) * mask.shell * (0.2 + 0.8 * apertureOpen);
      const shellShade = 7 + 9 * (1 - smoothstep(0.45, 1.0, r));
      const i = (y * width + x) * 4;

      let red = core.rgba[0] * biasedOpen + shellShade * shellMatter;
      let green = core.rgba[1] * biasedOpen + (shellShade * 0.72) * shellMatter;
      let blue = core.rgba[2] * biasedOpen + (shellShade * 0.58) * shellMatter;
      red += rimLight * 54;
      green += rimLight * 21;
      blue += rimLight * 5;

      if (r > 1.02) {
        red = 3;
        green = 4;
        blue = 6;
      }

      rgba[i] = clamp(red, 0, 255);
      rgba[i + 1] = clamp(green, 0, 255);
      rgba[i + 2] = clamp(blue, 0, 255);
      rgba[i + 3] = 255;
      const luma = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      if (r <= 0.98) {
        diskPixels++;
        if (r < 0.28) lumaCenter.add(luma);
        if (r > 0.72 && r < 0.95) lumaRim.add(luma);
      }
      if (biasedOpen > 0.32 && core.feature.hotCenter) counts.hotCenterPixels++;
      if (biasedOpen > 0.22 && (core.feature.radialRib || core.feature.dirtyPlate)) counts.radialRibPixels++;
      if (biasedOpen > 0.22 && core.feature.nestedRing) counts.nestedRingPixels++;
      if (biasedOpen > 0.22 && core.feature.occluder) counts.occluderPixels++;
      if (biasedOpen > 0.22 && core.feature.orangeChannel) counts.orangeChannelPixels++;
      if (biasedOpen > 0.18 && r < 0.96) counts.visibleCorePixels++;
      if (shellMatter > 0.55 && r < 0.96) counts.shellOccludedPixels++;
      if (rimLight > 0.22 && r < 0.98) counts.rimLightCatchPixels++;
      if (biasedOpen > 0.18 && core.feature.generatedSubstrate) counts.generatedSubstratePixels++;
      if (biasedOpen > 0.18 && core.feature.dirtyPlate) counts.dirtyPlatePixels++;
      if (biasedOpen > 0.18 && core.feature.underlightChannel) counts.underlightChannelPixels++;
      if (biasedOpen > 0.18 && core.feature.apertureWindow) counts.apertureWindowPixels++;
    }
  }
  return {
    identity: ORB_INNER_ENGINE_IDENTITY,
    width,
    height,
    seed,
    apertureOpen,
    rgba,
    metrics: finalMetrics(width, height, counts, lumaCenter, lumaRim, diskPixels),
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

export function encodeRgbaPng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writeRgbaPng(path, frame) {
  writeFileSync(path, encodeRgbaPng(frame.width, frame.height, frame.rgba));
}
