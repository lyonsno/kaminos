import {prepareSurfelAsset} from '../surfel-instances.mjs';

export default {
  id: 'surfel-study',
  title: 'Surfel batching',
  async create({host, inputs, record}) {
    const session = await host.scene.open();
    let asset, controller;
    try {
      if (inputs.asset) asset = await session.loadAsset({url: inputs.asset, arrival: 'append',
        metadata: {label: inputs.label || 'TRELLIS surfels'}});
      else {
        const selected = host.controls.document.defaultView.kaminosSelection?.read()?.activeId;
        const row = host.scene.objects().find(row => row.id === selected);
        if (!row) throw Error('Select a surfel asset in the scene, then open Surfel batching');
        asset = await session.attach(row.object, {owned: false});
      }
      controller = prepareSurfelAsset(asset.root);
      if (!controller.read().objects) throw Error('This asset has no declared TRELLIS surfel instances');
      if (inputs.asset) host.scene.frame([asset.root]);
    } catch (error) { await session.dispose(); throw error; }
    let checkbox, status, document, busy = false;
    const originalChunked = controller.read().chunked;
    const read = () => ({objectId: asset.id, source: asset.source,
      ...controller.read(), view: session.readView()});
    const refresh = () => {
      if (!status) return;
      const state = controller.read(), pending = state.picking.filter(row => row.status === 'building').length;
      const failed = state.picking.find(row => row.status === 'failed');
      const picks = state.picking.filter(row => row.candidates !== null);
      checkbox.checked = state.chunked; checkbox.disabled = busy || pending > 0;
      status.textContent = `${state.patches.toLocaleString()} patches · ${state.batches} draw batches`
        + (busy ? ' · Preparing batches…' : pending ? ' · Preparing spatial selection…' : failed ? ` · Selection fallback: ${failed.error}` : ' · Spatial selection')
        + (picks.length ? ` · Last query: ${picks.reduce((sum, row) => sum + row.candidates, 0).toLocaleString()} candidates` : '');
    };
    const stop = session.onFrame(refresh);
    return {
      read,
      operations: {
        async setChunked(value) {
          if (busy) throw Error('Spatial batching is already changing');
          busy = true; refresh();
          try {
            await controller.setChunked(value);
            session.redraw();
            const effective = read();
            record({kind: 'surfel-study.batching', phase: 'applied', target: asset.id,
              requested: Boolean(value), effective});
            return effective;
          } finally { busy = false; refresh(); }
        },
        frame() { host.scene.frame([asset.root]); return read(); },
        select() { host.scene.select(asset.id); return read(); },
      },
      mount({root, document: doc, invoke}) {
        document = doc;
        const label = document.createElement('label');
        checkbox = document.createElement('input'); checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label', 'Spatial batches');
        label.append(checkbox, document.createTextNode(' Spatial batches'));
        const help = document.createElement('p');
        help.textContent = 'Compare one batch with spatial batches. Both draw the same patches and materials; spatial batches allow finer camera and shadow culling. Click the surface to select it, then orbit or move it normally.';
        status = document.createElement('p'); status.setAttribute('role', 'status');
        const error = document.createElement('p'); error.setAttribute('role', 'alert');
        checkbox.addEventListener('change', () => {
          error.textContent = '';
          invoke('setChunked', checkbox.checked).catch(reason => { error.textContent = reason.message; refresh(); });
        });
        const frame = document.createElement('button'); frame.type = 'button'; frame.textContent = 'Frame asset';
        frame.addEventListener('click', () => invoke('frame').catch(reason => { error.textContent = reason.message; }));
        root.append(label, help, frame, status, error); refresh();
        controller.ready().then(refresh);
      },
      async dispose() {
        stop();
        await controller.setChunked(originalChunked);
        await session.dispose();
      },
    };
  },
};
