import {Mesh, PlaneGeometry, MeshBasicMaterial, TextureLoader, SRGBColorSpace, DoubleSide} from '../lib/three.core.js';
import {comparisonSequence} from './hand-comparison-sequence.mjs';

export default {
  id: 'hand-comparison',
  title: 'Recorded hand comparison',
  async create({host, inputs, record}) {
    const document = host.controls.document;
    const reportUrl = new URL(inputs.reportUrl, document.location.href);
    if (reportUrl.origin !== document.location.origin || !/^[a-f0-9]{64}$/.test(inputs.reportSha256 ?? '')) {
      throw Error('same-origin report and SHA-256 required');
    }
    const response = await fetch(reportUrl, {cache: 'no-store'});
    if (!response.ok) throw Error(`report HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(x => x.toString(16).padStart(2,'0')).join('');
    if (hash !== inputs.reportSha256) throw Error('report hash mismatch');
    const report = JSON.parse(new TextDecoder().decode(bytes));
    const sequence = comparisonSequence(report);
    const session = await host.scene.open();
    const geometry = new PlaneGeometry(4, 2.8);
    const material = new MeshBasicMaterial({color: 0xffffff, toneMapped: false, side: DoubleSide});
    const mesh = new Mesh(geometry, material); mesh.name = 'Recorded hand comparison'; mesh.position.y = 1.5;
    mesh.visible = false;
    const loader = new TextureLoader();
    let asset, texture, index = -1, requestedIndex = -1, generation = 0, disposed = false;
    let playing = false, elapsed = 0, pending = false, error = null, stop;
    let slider, play, status;
    const read = () => ({
      authority: 'recorded_diagnostic_not_live', interactionAuthority: false,
      reportUrl: reportUrl.href, reportSha256: hash, frameCount: sequence.length,
      index, requestedIndex, playing, pending, error,
      captureOffsetMs: index < 0 ? null : sequence.frame(index).captureOffsetMs,
      objectId: asset?.id ?? null, view: session.readView(),
    });
    const sync = () => {
      if (slider && index >= 0) slider.value = String(index);
      if (play) play.textContent = playing ? 'Pause' : 'Play';
      if (status) status.textContent = error ?? (pending ? `Loading ${requestedIndex + 1}; displayed ${index + 1}` :
        `Recorded | ${index + 1}/${sequence.length} | ${(read().captureOffsetMs / 1000).toFixed(3)} s`);
    };
    const show = async selected => {
      if (disposed) throw Error('comparison closed');
      const frame = sequence.frame(selected), ticket = ++generation;
      requestedIndex = selected; pending = true; error = null; sync();
      const url = new URL(reportUrl);
      if (url.pathname === '/api/read') {
        const path = url.searchParams.get('path') ?? '';
        url.searchParams.set('path', path.slice(0, path.lastIndexOf('/') + 1) + frame.file);
      } else {
        url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) + frame.file;
      }
      try {
        const loaded = await loader.loadAsync(url.href);
        if (disposed || ticket !== generation) {loaded.dispose(); return read();}
        loaded.colorSpace = SRGBColorSpace;
        texture?.dispose(); texture = loaded; material.map = loaded; material.needsUpdate = true;
        index = selected; pending = false; mesh.visible = true; sync(); session.redraw();
        return read();
      } catch (cause) {
        if (!disposed && ticket === generation) {
          pending = false; playing = false; error = `Capture ${selected + 1} unavailable: ${cause.message ?? cause}`;
          mesh.visible = false; sync(); session.redraw();
        }
        throw cause;
      }
    };
    const seek = async selected => {
      sequence.frame(selected);
      playing = false;
      elapsed = sequence.frame(selected).captureOffsetMs - sequence.frame(0).captureOffsetMs;
      const effective = await show(selected);
      record({kind: 'hand-comparison.seek', phase: 'applied', requested: selected, effective});
      return effective;
    };
    const frameView = () => {
      const width = document.defaultView.innerWidth;
      return session.setView({position: [0, 1.5, width < 600 ? 9.8 : 5.5], target: [0, 1.5, 0]});
    };
    try {
      asset = await session.attach(mesh, {owned: true, metadata: {
        label: mesh.name, source: reportUrl.href, type: 'recorded-diagnostic',
      }});
      await seek(inputs.index ?? 0); frameView();
      document.defaultView.kaminosSelection?.clear();
      stop = session.onFrame(({deltaSeconds}) => {
        if (!playing || pending || disposed) return;
        elapsed += deltaSeconds * 1000;
        const next = sequence.atTime(elapsed);
        if (next !== index) void show(next).catch(() => {});
        if (elapsed >= sequence.durationMs) {playing = false; sync();}
      });
    } catch (cause) {
      disposed = true; generation++; stop?.(); texture?.dispose();
      await session.dispose(); geometry.dispose(); material.dispose(); throw cause;
    }
    return {
      read,
      operations: {
        seek,
        async play() {
          if (error) throw Error(error);
          if (index === sequence.length - 1) await seek(0);
          playing = true; sync(); record({kind: 'hand-comparison.play', phase: 'applied', effective: read()});
          return read();
        },
        pause() {
          playing = false; sync(); record({kind: 'hand-comparison.pause', phase: 'applied', effective: read()});
          return read();
        },
        frame: frameView,
      },
      mount({root, document, invoke}) {
        const label = document.createElement('label'); label.textContent = 'Capture';
        slider = document.createElement('input'); slider.type = 'range';
        slider.min = '0'; slider.max = String(sequence.length - 1); slider.step = '1';
        slider.setAttribute('aria-label', 'Recorded capture'); slider.style.width = '100%';
        play = document.createElement('button'); play.type = 'button';
        const frame = document.createElement('button'); frame.type = 'button'; frame.textContent = 'Frame comparison';
        status = document.createElement('div'); status.setAttribute('role', 'status'); status.dataset.handComparisonStatus = '';
        status.style.overflowWrap = 'anywhere';
        const failed = cause => {status.textContent = cause.message;};
        slider.addEventListener('input', () => invoke('seek', Number(slider.value)).catch(failed));
        play.addEventListener('click', () => invoke(playing ? 'pause' : 'play').catch(failed));
        frame.addEventListener('click', () => invoke('frame').catch(failed));
        label.append(slider); root.append(label, play, frame, status); sync();
      },
      async dispose() {
        disposed = true; playing = false; generation++; stop?.(); texture?.dispose(); await session.dispose();
      },
    };
  },
};
