/**
 * Kaminos text-to-motion panel — generation, playback, skeleton rendering.
 * Talks to motion-serve.py running on port 8091.
 */

const MOTION_SERVER = 'http://localhost:8098';

// ---------- State ----------
let motionData = null;        // { joints, num_frames, fps, ... }
let motionFrame = 0;
let motionPlaying = false;
let motionAnimId = null;
let motionSkeletonGroup = null; // THREE.Group for skeleton visualization
let motionYOffset = 0;         // vertical offset to ground the figure
let motionHistory = [];        // array of past generation results

// ---------- Slider wiring ----------
function initMotionSliders() {
  const wire = (id, valId, suffix = '') => {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valId);
    if (!el || !valEl) return;
    el.addEventListener('input', () => { valEl.textContent = el.value + suffix; });
  };
  wire('motion-duration', 'motion-duration-val', 's');
  wire('motion-guidance', 'motion-guidance-val', '');
  wire('motion-steps', 'motion-steps-val', '');

  const frameSlider = document.getElementById('motion-frame-slider');
  if (frameSlider) {
    frameSlider.addEventListener('input', () => {
      motionFrame = parseInt(frameSlider.value);
      document.getElementById('motion-frame-val').textContent = motionFrame;
      renderMotionFrame(motionFrame);
    });
  }
}

// ---------- Server health check ----------
async function checkMotionServer() {
  const statusEl = document.getElementById('motion-server-status');
  try {
    const resp = await fetch(`${MOTION_SERVER}/health`);
    const data = await resp.json();
    if (data.model_loaded) {
      statusEl.textContent = 'connected';
      statusEl.style.color = '#66bb6a';
    } else {
      statusEl.textContent = 'no model loaded';
      statusEl.style.color = '#ffa726';
    }
  } catch {
    statusEl.textContent = 'not connected';
    statusEl.style.color = '#ef5350';
  }
}

// ---------- Generation ----------
async function generateMotion() {
  const prompt = document.getElementById('motion-prompt').value.trim();
  if (!prompt) return;

  const statusEl = document.getElementById('motion-status');
  const genBtn = document.getElementById('motion-gen-btn');
  const playbackEl = document.getElementById('motion-playback');

  const duration = parseFloat(document.getElementById('motion-duration').value);
  const guidance = parseFloat(document.getElementById('motion-guidance').value);
  const steps = parseInt(document.getElementById('motion-steps').value);
  const seedInput = document.getElementById('motion-seed').value.trim();
  const seed = seedInput ? parseInt(seedInput) : null;

  // Stop any existing playback before generating new motion
  stopMotionPlayback();

  statusEl.textContent = 'Generating...';
  statusEl.style.color = '#42a5f5';
  genBtn.disabled = true;
  genBtn.textContent = 'Generating...';

  // Poll progress while generating
  let progressInterval = setInterval(async () => {
    try {
      const pr = await fetch(`${MOTION_SERVER}/progress`);
      const pg = await pr.json();
      if (pg.active) {
        const pct = pg.total_steps > 0 ? Math.round(100 * pg.step / pg.total_steps) : 0;
        const bar = '\u2588'.repeat(Math.floor(pct / 5)) + '\u2591'.repeat(20 - Math.floor(pct / 5));
        statusEl.textContent = `${pg.phase}: ${bar} ${pct}% (${pg.step}/${pg.total_steps}) ${pg.elapsed}s`;
      }
    } catch {}
  }, 500);

  try {
    const body = { prompt, duration, guidance, steps };
    if (seed !== null) body.seed = seed;

    const resp = await fetch(`${MOTION_SERVER}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    clearInterval(progressInterval);
    const data = await resp.json();

    if (data.error) {
      statusEl.textContent = `Error: ${data.error}`;
      statusEl.style.color = '#ef5350';
      return;
    }

    motionData = data;
    motionFrame = 0;

    // Update info
    document.getElementById('motion-info-frames').textContent = data.num_frames;
    document.getElementById('motion-info-duration').textContent = `${data.duration.toFixed(1)}s`;
    document.getElementById('motion-info-gentime').textContent = `${data.gen_time}s`;
    document.getElementById('motion-info-joints').textContent = `${data.num_joints} (${data.skeleton_type})`;

    // Configure frame slider
    const slider = document.getElementById('motion-frame-slider');
    slider.max = data.num_frames - 1;
    slider.value = 0;
    document.getElementById('motion-frame-val').textContent = '0';

    playbackEl.style.display = 'block';
    statusEl.textContent = `Generated ${data.num_frames} frames in ${data.gen_time}s`;
    statusEl.style.color = '#66bb6a';

    // Compute vertical offset to ground the figure
    // Find the minimum Y across all frames and all joints
    let minY = Infinity;
    for (let f = 0; f < data.joints.length; f++) {
      for (let j = 0; j < data.joints[f].length; j++) {
        if (data.joints[f][j][1] < minY) minY = data.joints[f][j][1];
      }
    }
    motionYOffset = minY;

    // Build skeleton visualization
    buildMotionSkeleton(data);
    renderMotionFrame(0);

    // Add to history
    addToMotionHistory(data);

    // Auto-play
    startMotionPlayback();

  } catch (err) {
    clearInterval(progressInterval);
    statusEl.textContent = `Connection error: ${err.message}`;
    statusEl.style.color = '#ef5350';
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = 'Generate Motion';
  }
}
window.generateMotion = generateMotion;

// ---------- Skeleton rendering ----------
function buildMotionSkeleton(data) {
  const THREE_NS = window.THREE || window.__THREE__;
  if (!THREE_NS) {
    console.warn('[motion] THREE not available, skeleton rendering disabled');
    return;
  }

  // Remove old skeleton
  if (motionSkeletonGroup) {
    if (motionSkeletonGroup.parent) motionSkeletonGroup.parent.remove(motionSkeletonGroup);
    motionSkeletonGroup = null;
  }

  const group = new THREE_NS.Group();
  group.name = 'motion-skeleton';

  const numJoints = data.num_joints;
  const parents = data.parents || [];

  // Joint spheres — all joints
  const jointMat = new THREE_NS.MeshBasicMaterial({ color: 0xff6600 });
  const jointGeo = new THREE_NS.SphereGeometry(0.015, 6, 6);
  const jointMeshes = [];
  for (let i = 0; i < numJoints; i++) {
    const sphere = new THREE_NS.Mesh(jointGeo, jointMat);
    jointMeshes.push(sphere);
    group.add(sphere);
  }
  group.userData.jointMeshes = jointMeshes;

  // Bone lines — one line segment per parent-child connection
  const bones = [];
  for (let i = 0; i < parents.length; i++) {
    if (parents[i] >= 0 && parents[i] !== i) {
      bones.push([parents[i], i]);
    }
  }
  group.userData.bones = bones;

  const boneMat = new THREE_NS.LineBasicMaterial({ color: 0xff8800 });
  const positions = new Float32Array(bones.length * 2 * 3);
  const lineGeo = new THREE_NS.BufferGeometry();
  lineGeo.setAttribute('position', new THREE_NS.BufferAttribute(positions, 3));
  lineGeo.setDrawRange(0, bones.length * 2);
  const lines = new THREE_NS.LineSegments(lineGeo, boneMat);
  group.add(lines);
  group.userData.boneLines = lines;

  if (window.__kaminosScene) {
    window.__kaminosScene.add(group);
  }
  motionSkeletonGroup = group;
}

function renderMotionFrame(frame) {
  if (!motionData || !motionSkeletonGroup) return;

  const joints = motionData.joints;
  if (frame >= joints.length) return;

  const frameJoints = joints[frame];
  const meshes = motionSkeletonGroup.userData.jointMeshes;
  const boneLines = motionSkeletonGroup.userData.boneLines;
  const bones = motionSkeletonGroup.userData.bones;

  // Update joint sphere positions (grounded by subtracting minY)
  const yOff = motionYOffset;
  for (let i = 0; i < meshes.length && i < frameJoints.length; i++) {
    const [x, y, z] = frameJoints[i];
    meshes[i].position.set(x, y - yOff, z);
  }

  // Update bone line positions
  if (boneLines && bones) {
    const posAttr = boneLines.geometry.getAttribute('position');
    const arr = posAttr.array;
    for (let b = 0; b < bones.length; b++) {
      const [parentIdx, childIdx] = bones[b];
      const pj = frameJoints[parentIdx];
      const cj = frameJoints[childIdx];
      if (pj && cj) {
        arr[b * 6 + 0] = pj[0]; arr[b * 6 + 1] = pj[1] - yOff; arr[b * 6 + 2] = pj[2];
        arr[b * 6 + 3] = cj[0]; arr[b * 6 + 4] = cj[1] - yOff; arr[b * 6 + 5] = cj[2];
      }
    }
    posAttr.needsUpdate = true;
  }
}

// ---------- Playback ----------
function startMotionPlayback() {
  if (!motionData) return;
  // Stop any existing loop first
  stopMotionPlayback();

  motionPlaying = true;
  const playBtn = document.getElementById('motion-play-btn');
  const stopBtn = document.getElementById('motion-stop-btn');
  if (playBtn) playBtn.textContent = 'Pause';
  if (stopBtn) stopBtn.style.display = 'inline-block';

  const fps = motionData.fps || 30;
  const sliderEl = document.getElementById('motion-frame-slider');
  const frameValEl = document.getElementById('motion-frame-val');

  // Use setInterval for resilience — rAF can stall if the tab
  // loses focus or the WebGPU render loop contends for frame budget
  const capturedData = motionData;
  motionAnimId = setInterval(() => {
    try {
      if (!capturedData || !capturedData.joints) return;
      motionFrame = (motionFrame + 1) % capturedData.num_frames;
      renderMotionFrame(motionFrame);
      if (sliderEl) sliderEl.value = motionFrame;
      if (frameValEl) frameValEl.textContent = motionFrame;
    } catch (err) {
      console.error('[motion] playback error:', err);
    }
  }, 1000 / fps);
}

function stopMotionPlayback() {
  motionPlaying = false;
  if (motionAnimId) {
    clearInterval(motionAnimId);
    motionAnimId = null;
  }
  const playBtn = document.getElementById('motion-play-btn');
  const stopBtn = document.getElementById('motion-stop-btn');
  if (playBtn) playBtn.textContent = 'Play';
  if (stopBtn) stopBtn.style.display = 'none';
}
window.stopMotionPlayback = stopMotionPlayback;

function toggleMotionPlayback() {
  if (motionPlaying) {
    stopMotionPlayback();
  } else {
    startMotionPlayback();
  }
}
window.toggleMotionPlayback = toggleMotionPlayback;

function motionFrameStep(delta) {
  if (!motionData) return;
  stopMotionPlayback();
  motionFrame = Math.max(0, Math.min(motionData.num_frames - 1, motionFrame + delta));
  document.getElementById('motion-frame-slider').value = motionFrame;
  document.getElementById('motion-frame-val').textContent = motionFrame;
  renderMotionFrame(motionFrame);
}
window.motionFrameStep = motionFrameStep;

// ---------- Export ----------
function exportMotionData() {
  if (!motionData) return;
  const blob = new Blob([JSON.stringify(motionData)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `motion_${motionData.prompt.slice(0, 30).replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
window.exportMotionData = exportMotionData;

// ---------- History ----------
function addToMotionHistory(data) {
  const entry = {
    prompt: data.prompt,
    num_frames: data.num_frames,
    duration: data.duration,
    gen_time: data.gen_time,
    model: data.model,
    skeleton_type: data.skeleton_type,
    timestamp: new Date().toLocaleTimeString(),
    data: data, // keep full data for reload
  };
  motionHistory.unshift(entry); // newest first
  if (motionHistory.length > 20) motionHistory.pop(); // cap at 20
  renderMotionHistory();
}

function renderMotionHistory() {
  const container = document.getElementById('motion-history');
  if (!container) return;

  container.innerHTML = motionHistory.map((entry, idx) => `
    <div class="gr-entry" onclick="loadMotionFromHistory(${idx})" title="${entry.prompt}">
      <div class="gr-icon" style="font-size: 16px;">🦴</div>
      <div class="gr-entry-main">
        <div class="gr-title">${entry.prompt.length > 40 ? entry.prompt.slice(0, 40) + '...' : entry.prompt}</div>
        <div class="gr-subtitle">${entry.num_frames}f / ${entry.duration.toFixed(1)}s / ${entry.gen_time}s / ${entry.model} / ${entry.timestamp}</div>
      </div>
    </div>
  `).join('');
}

function loadMotionFromHistory(idx) {
  const entry = motionHistory[idx];
  if (!entry || !entry.data) return;

  stopMotionPlayback();
  motionData = entry.data;
  motionFrame = 0;

  // Recompute Y offset
  let minY = Infinity;
  for (let f = 0; f < motionData.joints.length; f++) {
    for (let j = 0; j < motionData.joints[f].length; j++) {
      if (motionData.joints[f][j][1] < minY) minY = motionData.joints[f][j][1];
    }
  }
  motionYOffset = minY;

  // Update info panel
  document.getElementById('motion-info-frames').textContent = motionData.num_frames;
  document.getElementById('motion-info-duration').textContent = `${motionData.duration.toFixed(1)}s`;
  document.getElementById('motion-info-gentime').textContent = `${motionData.gen_time}s`;
  document.getElementById('motion-info-joints').textContent = `${motionData.num_joints} (${motionData.skeleton_type})`;

  const slider = document.getElementById('motion-frame-slider');
  slider.max = motionData.num_frames - 1;
  slider.value = 0;
  document.getElementById('motion-frame-val').textContent = '0';
  document.getElementById('motion-playback').style.display = 'block';

  const statusEl = document.getElementById('motion-status');
  statusEl.textContent = `Loaded: ${entry.prompt.slice(0, 50)}`;
  statusEl.style.color = '#42a5f5';

  buildMotionSkeleton(motionData);
  renderMotionFrame(0);
  startMotionPlayback();
}
window.loadMotionFromHistory = loadMotionFromHistory;

// ---------- Init ----------
function initMotionPanel() {
  initMotionSliders();
  checkMotionServer();
  // Re-check server every 10s
  setInterval(checkMotionServer, 10000);
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMotionPanel);
} else {
  initMotionPanel();
}
