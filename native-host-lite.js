import {
  KAMINOS_GLOVE_WELL_HOST_ROUTE,
  KAMINOS_GLOVE_WELL_HOST_STATE_SCHEMA,
  LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA,
  LERMS_GLOVE_WELL_HOST_PACKET_ROUTE,
  createGloveWellHostState,
} from './glove-well-host-core.js';

const GLOVE_WELL_HOST_DEFAULT_ROOT = 'scratch';
const GLOVE_WELL_HOST_DEFAULT_PATH = 'greedy-glove-well-host-packet-0701.json';
const GLOVE_WELL_HOST_DEFAULT_URL = `/api/read?${new URLSearchParams({
  root: GLOVE_WELL_HOST_DEFAULT_ROOT,
  path: GLOVE_WELL_HOST_DEFAULT_PATH,
})}`;
const GLOVE_WELL_HOST_DEFAULT_POLL_MS = 1000;

let kaminosHostSurfaceState = null;
let gloveWellHostPacket = null;
let gloveWellHostLiveTimer = null;
let gloveWellHostPacketLoadCount = 0;
let gloveWellHostLastLoadedAt = null;
let gloveWellHostState = {
  schema: KAMINOS_GLOVE_WELL_HOST_STATE_SCHEMA,
  route: KAMINOS_GLOVE_WELL_HOST_ROUTE,
  status: 'idle',
  effectiveUrl: GLOVE_WELL_HOST_DEFAULT_URL,
  packetSchema: LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA,
  packetRoute: LERMS_GLOVE_WELL_HOST_PACKET_ROUTE,
  sourceAuthority: 'pending',
  sourceTruthAuthority: 'pending',
  freshness: { status: 'pending' },
  coordinateFrame: { space: 'operator_visible_webcam_mirrored_screen_normalized' },
  surface: { primitives: [], primitiveRoles: [] },
  goins: [],
  lermDesireHints: [],
  packetLoadCount: 0,
  lastPacketLoadedAt: null,
  liveBridge: {
    enabled: false,
    active: false,
    status: 'idle',
    pollMs: null,
    routeMode: 'default_root_path',
    nextPollAt: null,
    lastLoadedAt: null,
  },
  downgrades: ['local_browser_smoke_not_native_kaminos_host', 'visual_capture_not_source_truth'],
  rejectedDebugSurfaces: [],
  error: null,
};

function setInfo(message) {
  const el = document.getElementById('info-bar');
  if (el) el.textContent = message;
}

function setActiveTab(tabName) {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
  const gloveWellHostPanel = document.getElementById('glove-well-host-operator-panel');
  if (gloveWellHostPanel) gloveWellHostPanel.hidden = tabName !== 'glove-well-host';
}

function publishKaminosHostSurfaceState(state, status = 'loaded') {
  const next = state?.hostSurface ? {
    ...state.hostSurface,
    liveBridge: state.liveBridge || state.hostSurface.liveBridge || null,
    packetLoadCount: state.packetLoadCount ?? state.hostSurface.packetLoadCount ?? null,
    lastPacketLoadedAt: state.lastPacketLoadedAt ?? state.hostSurface.lastPacketLoadedAt ?? null,
    routeMode: state.routeMode || state.hostSurface.routeMode || null,
  } : state;
  if (!next) return kaminosHostSurfaceState;
  kaminosHostSurfaceState = { ...next, status };
  window.__kaminosHostSurfaceDebugState = kaminosHostSurfaceState;
  return kaminosHostSurfaceState;
}

function gloveWellHostRouteFromParams(params = new URLSearchParams(window.location.search)) {
  const directUrl = params.get('glove_well_host_url');
  const live = params.get('glove_well_host_live') === '1' || params.get('glove_well_host_live') === 'true';
  const requestedPollMs = Number(params.get('glove_well_host_poll_ms'));
  const pollMs = Number.isFinite(requestedPollMs) && requestedPollMs > 0 ? requestedPollMs : GLOVE_WELL_HOST_DEFAULT_POLL_MS;
  if (directUrl) return { url: directUrl, mode: 'external_url', live, pollMs };
  const root = params.get('glove_well_host_root');
  const path = params.get('glove_well_host_path');
  if (root && path) {
    return {
      url: `/api/read?${new URLSearchParams({ root, path })}`,
      mode: 'root_path',
      root,
      path,
      live,
      pollMs,
    };
  }
  return {
    url: GLOVE_WELL_HOST_DEFAULT_URL,
    mode: 'default_root_path',
    root: GLOVE_WELL_HOST_DEFAULT_ROOT,
    path: GLOVE_WELL_HOST_DEFAULT_PATH,
    live,
    pollMs,
  };
}

function gloveWellHostLiveStatusLabel(state = gloveWellHostState) {
  const bridge = state.liveBridge || {};
  const status = bridge.status || (bridge.active ? 'polling' : 'idle');
  const statusLabel = {
    idle: 'packet idle',
    loading: 'packet loading',
    loaded: 'packet loaded',
    polling: 'packet polling',
    stopped: 'packet polling stopped',
    error: 'packet error',
    'polling-error': 'packet polling error',
  }[status] || `packet ${status}`;
  const cadence = Number.isFinite(Number(bridge.pollMs)) && Number(bridge.pollMs) > 0 ? `${Number(bridge.pollMs)}ms` : 'manual';
  const count = Number.isFinite(Number(state.packetLoadCount)) ? Number(state.packetLoadCount) : 0;
  return `${statusLabel} · ${cadence} · ${count} loads`;
}

function updateGloveWellHostReadout() {
  const state = gloveWellHostState;
  const sourceAuthorityEl = document.getElementById('glove-well-host-source-authority');
  if (!sourceAuthorityEl) return;
  document.getElementById('glove-well-host-packet-schema').textContent = state.packetSchema || LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA;
  document.getElementById('glove-well-host-packet-url').textContent = state.effectiveUrl || 'pending';
  sourceAuthorityEl.textContent = state.sourceAuthority || 'pending';
  document.getElementById('glove-well-host-source-truth').textContent = state.sourceTruthAuthority || 'pending';
  document.getElementById('glove-well-host-freshness').textContent = state.freshness?.status || 'pending';
  document.getElementById('glove-well-host-live-status').textContent = gloveWellHostLiveStatusLabel(state);
  document.getElementById('glove-well-host-frame').textContent = state.coordinateFrame?.space || 'pending';
  document.getElementById('glove-well-host-phase').textContent = state.gloveWell?.phase || 'pending';
  document.getElementById('glove-well-host-primitives').textContent = String(state.surface?.primitiveCount ?? state.surface?.primitives?.length ?? 0);
  document.getElementById('glove-well-host-goins').textContent = String(state.goins?.length || 0);
  document.getElementById('glove-well-host-custody').textContent = state.sourceCustody?.greedyOwns?.length && state.sourceCustody?.kaminosOwns?.length
    ? 'split'
    : 'pending';
  sourceAuthorityEl.classList.toggle('present', state.sourceAuthority === 'synthetic_fixture' || state.sourceAuthority === 'live_simulation');
  sourceAuthorityEl.classList.toggle('missing', state.status === 'error' || state.sourceAuthority === 'pending');
  const downgradeList = document.getElementById('glove-well-host-downgrades');
  downgradeList.innerHTML = '';
  const downgrades = state.downgrades?.length ? state.downgrades : ['local_browser_smoke_not_native_kaminos_host', 'visual_capture_not_source_truth'];
  for (const downgrade of downgrades) {
    const chip = document.createElement('span');
    chip.className = 'glove-well-host-chip';
    chip.textContent = downgrade;
    downgradeList.appendChild(chip);
  }
  document.getElementById('glove-well-host-overlay-body').textContent = [
    KAMINOS_GLOVE_WELL_HOST_ROUTE,
    state.packetSchema || LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA,
    state.sourceAuthority || 'pending',
    state.freshness?.status || 'pending',
    gloveWellHostLiveStatusLabel(state),
    `phase:${state.gloveWell?.phase || 'pending'}`,
    `${state.surface?.primitiveCount ?? state.surface?.primitives?.length ?? 0} primitives`,
    ...downgrades.slice(0, 2),
  ].join(' · ');
}

function canvasPoint(point, width, height) {
  const x = Math.max(0, Math.min(1, Number(point?.x ?? 0.5)));
  const y = Math.max(0, Math.min(1, Number(point?.y ?? 0.5)));
  return [x * width, y * height];
}

function canvasColor(color, alpha = 1) {
  const raw = String(color || '#82e2be').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) {
    const r = parseInt(raw.slice(1, 3), 16);
    const g = parseInt(raw.slice(3, 5), 16);
    const b = parseInt(raw.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }
  return raw;
}

function drawPrimitive(ctx, primitive, width, height) {
  const alpha = primitive.alpha ?? 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = canvasColor(primitive.color, alpha);
  ctx.strokeStyle = canvasColor(primitive.color, alpha);
  ctx.lineWidth = Math.max(1.5, 2.5 * window.devicePixelRatio);
  if (primitive.kind === 'line') {
    const [x1, y1] = canvasPoint(primitive.start, width, height);
    const [x2, y2] = canvasPoint(primitive.end, width, height);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else if (primitive.kind === 'ellipse') {
    const [x, y] = canvasPoint(primitive.center, width, height);
    const radiusX = Math.max(2, Number(primitive.radiusX || primitive.radius || 0.02) * width);
    const radiusY = Math.max(2, Number(primitive.radiusY || primitive.radius || 0.02) * height);
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (primitive.kind === 'badge') {
    const [x, y] = canvasPoint(primitive.center, width, height);
    ctx.font = `${Math.max(10, 11 * window.devicePixelRatio)}px "SF Mono", monospace`;
    const text = primitive.text || primitive.role || primitive.id;
    const metrics = ctx.measureText(text);
    ctx.fillStyle = 'rgba(5, 11, 10, 0.78)';
    ctx.strokeStyle = canvasColor(primitive.color || '#82e2be', 0.9);
    ctx.lineWidth = Math.max(1, window.devicePixelRatio);
    ctx.beginPath();
    ctx.roundRect(x, y, metrics.width + 18, 22 * window.devicePixelRatio, 5 * window.devicePixelRatio);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = canvasColor(primitive.color || '#82e2be', 1);
    ctx.fillText(text, x + 9, y + 15 * window.devicePixelRatio);
  } else {
    const [x, y] = canvasPoint(primitive.center, width, height);
    const radius = Math.max(2.5, Number(primitive.radius || 0.012) * Math.min(width, height));
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGloveWellHostPreview() {
  const canvas = document.getElementById('glove-well-host-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio));
  const height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createRadialGradient(width * 0.35, height * 0.58, width * 0.03, width * 0.5, height * 0.56, width * 0.76);
  gradient.addColorStop(0, '#24332c');
  gradient.addColorStop(0.55, '#0b1210');
  gradient.addColorStop(1, '#030505');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.strokeStyle = 'rgba(111, 172, 151, 0.22)';
  ctx.lineWidth = Math.max(1, window.devicePixelRatio);
  for (let i = 1; i < 4; i += 1) {
    const x = (width / 4) * i;
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
  for (const primitive of gloveWellHostState.surface?.primitives || []) {
    drawPrimitive(ctx, primitive, width, height);
  }
}

async function loadPacketFromUrl(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Glove Well host packet fetch failed ${response.status}: ${url}`);
  return response.json();
}

async function loadGloveWellHostPacket(route = gloveWellHostRouteFromParams()) {
  const priorLive = gloveWellHostState.liveBridge || {};
  gloveWellHostState = {
    ...gloveWellHostState,
    status: 'loading',
    effectiveUrl: route.url,
    routeMode: route.mode,
    liveBridge: {
      ...priorLive,
      enabled: priorLive.enabled === true || route.live === true,
      status: priorLive.active ? 'polling' : 'loading',
      pollMs: priorLive.pollMs || route.pollMs || GLOVE_WELL_HOST_DEFAULT_POLL_MS,
      routeMode: route.mode,
      lastRequestedAt: new Date().toISOString(),
    },
    error: null,
  };
  publishKaminosHostSurfaceState(gloveWellHostState, 'loading');
  updateGloveWellHostReadout();
  const packet = await loadPacketFromUrl(route.url);
  gloveWellHostPacket = packet;
  gloveWellHostPacketLoadCount += 1;
  gloveWellHostLastLoadedAt = new Date().toISOString();
  const pollMs = gloveWellHostState.liveBridge?.pollMs || route.pollMs || GLOVE_WELL_HOST_DEFAULT_POLL_MS;
  const liveBridge = {
    ...gloveWellHostState.liveBridge,
    enabled: gloveWellHostState.liveBridge?.enabled === true || route.live === true,
    active: gloveWellHostState.liveBridge?.active === true,
    status: gloveWellHostState.liveBridge?.active ? 'polling' : 'loaded',
    pollMs,
    routeMode: route.mode,
    lastLoadedAt: gloveWellHostLastLoadedAt,
    nextPollAt: gloveWellHostState.liveBridge?.active ? new Date(Date.now() + pollMs).toISOString() : null,
  };
  gloveWellHostState = {
    ...createGloveWellHostState(packet, { effectiveUrl: route.url }),
    status: 'loaded',
    routeMode: route.mode,
    packetLoadCount: gloveWellHostPacketLoadCount,
    lastPacketLoadedAt: gloveWellHostLastLoadedAt,
    liveBridge,
    error: null,
  };
  publishKaminosHostSurfaceState(gloveWellHostState, 'loaded');
  updateGloveWellHostReadout();
  drawGloveWellHostPreview();
  setInfo(`Glove Well host packet loaded: ${gloveWellHostState.sourceAuthority} - ${gloveWellHostState.surface?.primitiveCount || 0} primitives`);
  return gloveWellHostState;
}

function stopGloveWellHostLive() {
  if (gloveWellHostLiveTimer) {
    clearTimeout(gloveWellHostLiveTimer);
    gloveWellHostLiveTimer = null;
  }
  gloveWellHostState = {
    ...gloveWellHostState,
    liveBridge: {
      ...(gloveWellHostState.liveBridge || {}),
      enabled: false,
      active: false,
      status: 'stopped',
      nextPollAt: null,
    },
  };
  publishKaminosHostSurfaceState(gloveWellHostState, 'loaded');
  updateGloveWellHostReadout();
  return gloveWellHostState;
}

function schedulePoll(route) {
  if (!gloveWellHostState.liveBridge?.active) return;
  const pollMs = Number.isFinite(Number(route.pollMs)) && Number(route.pollMs) > 0 ? Number(route.pollMs) : GLOVE_WELL_HOST_DEFAULT_POLL_MS;
  gloveWellHostState = {
    ...gloveWellHostState,
    liveBridge: {
      ...(gloveWellHostState.liveBridge || {}),
      nextPollAt: new Date(Date.now() + pollMs).toISOString(),
    },
  };
  updateGloveWellHostReadout();
  gloveWellHostLiveTimer = setTimeout(() => {
    if (!gloveWellHostState.liveBridge?.active) return;
    loadGloveWellHostPacket(route)
      .catch(error => {
        gloveWellHostState = {
          ...gloveWellHostState,
          status: 'error',
          liveBridge: {
            ...(gloveWellHostState.liveBridge || {}),
            status: 'polling-error',
          },
          error: String(error?.message || error),
        };
        publishKaminosHostSurfaceState(gloveWellHostState, 'error');
        updateGloveWellHostReadout();
        setInfo(`Glove Well packet polling failed: ${error.message || error}`);
      })
      .finally(() => schedulePoll(route));
  }, pollMs);
}

function startGloveWellHostLive(route = gloveWellHostRouteFromParams()) {
  if (gloveWellHostLiveTimer) {
    clearTimeout(gloveWellHostLiveTimer);
    gloveWellHostLiveTimer = null;
  }
  const pollMs = Number.isFinite(Number(route.pollMs)) && Number(route.pollMs) > 0 ? Number(route.pollMs) : GLOVE_WELL_HOST_DEFAULT_POLL_MS;
  const liveRoute = { ...route, live: true, pollMs };
  gloveWellHostState = {
    ...gloveWellHostState,
    effectiveUrl: route.url,
    routeMode: route.mode,
    liveBridge: {
      ...(gloveWellHostState.liveBridge || {}),
      enabled: true,
      active: true,
      status: 'polling',
      pollMs,
      routeMode: route.mode,
      nextPollAt: null,
      startedAt: new Date().toISOString(),
    },
  };
  publishKaminosHostSurfaceState(gloveWellHostState, 'loading');
  updateGloveWellHostReadout();
  loadGloveWellHostPacket(liveRoute)
    .catch(error => {
      console.error('Glove Well packet polling load failed:', error);
      setInfo(`Glove Well packet polling failed: ${error.message || error}`);
    })
    .finally(() => schedulePoll(liveRoute));
  return gloveWellHostState;
}

function init() {
  const params = new URLSearchParams(window.location.search);
  setActiveTab('glove-well-host');
  document.getElementById('glove-well-host-load')?.addEventListener('click', () => {
    loadGloveWellHostPacket(gloveWellHostRouteFromParams()).catch(error => {
      console.error('Glove Well host load failed:', error);
      setInfo(`Glove Well host packet failed: ${error.message || error}`);
    });
  });
  document.getElementById('glove-well-host-live-start')?.addEventListener('click', () => {
    startGloveWellHostLive(gloveWellHostRouteFromParams());
  });
  document.getElementById('glove-well-host-live-stop')?.addEventListener('click', () => {
    stopGloveWellHostLive();
  });
  window.kaminosHostSurfaceDebugState = () => kaminosHostSurfaceState;
  window.kaminosGloveWellHostDebugState = () => gloveWellHostState;
  window.__kaminosGloveWellHostDebugState = () => gloveWellHostState;
  window.kaminosLoadGloveWellHostPacket = loadGloveWellHostPacket;
  window.kaminosStartGloveWellHostLive = startGloveWellHostLive;
  window.kaminosStopGloveWellHostLive = stopGloveWellHostLive;
  window.addEventListener('resize', drawGloveWellHostPreview);
  updateGloveWellHostReadout();
  drawGloveWellHostPreview();
  const route = gloveWellHostRouteFromParams(params);
  if (route.live) startGloveWellHostLive(route);
  else loadGloveWellHostPacket(route).catch(error => {
    console.error('Glove Well host route load failed:', error);
    setInfo(`Glove Well host packet failed: ${error.message || error}`);
  });
}

init();
