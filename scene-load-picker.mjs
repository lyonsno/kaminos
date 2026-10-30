// Saved-scene picker for Load: the scenes Kaminos saved, newest first, with a
// filter. Type to narrow, arrows to move, Enter or a click to open, Escape to
// close. "Browse files…" falls back to the system file picker.
// scenes: [{ name, label, timestamp, store? }] where store ({ id, label })
// marks a scene saved by another Kaminos server on this machine. This
// server's scenes list first. `more` (a promise of further scenes, such as the
// other servers' scan) fills in after the list opens. Resolves
// { name, store }, 'browse', or null.

export function scenePickerTitle(scene) {return scene.name.replace(/\.kaminos\.json$/, '');}

export function sortScenesNewestFirst(scenes) {
  return [...scenes].sort((a, b) => Number(!!a.store) - Number(!!b.store)
    || String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || a.name.localeCompare(b.name));
}

export function sceneMatchesFilter(scene, filter) {
  const words = String(filter || '').toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${scene.label || ''} ${scene.name} ${scene.store?.label || ''}`.toLowerCase();
  return words.every(word => haystack.includes(word));
}

function savedWhen(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function pickSavedScene({ scenes = [], local = null, more = null, moreDetails = null, host = document.body } = {}) {
  return new Promise(resolve => {
    let ordered = sortScenesNewestFirst(scenes);
    let pending = !!more;
    let localPending = !!local;
    let listingError = '';
    const backdrop = document.createElement('div');
    backdrop.className = 'file-name-prompt scene-load-picker';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML = `
      <div class="file-name-prompt-panel scene-load-picker-panel">
        <div class="file-name-prompt-title">Open saved scene</div>
        <label class="file-name-prompt-row"><input type="text" spellcheck="false" autocomplete="off" placeholder="Filter"></label>
        <div class="scene-load-picker-list" role="listbox"></div>
        <div class="file-name-prompt-message" role="status"></div>
        <div class="file-name-prompt-actions"><button type="button" data-scene-browse>Browse files…</button><button type="button" data-scene-cancel>Cancel</button></div>
      </div>`;
    const list = backdrop.querySelector('.scene-load-picker-list'), input = backdrop.querySelector('input');
    const note = backdrop.querySelector('.file-name-prompt-message');
    const makeRow = scene => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'scene-load-picker-row';
      row.dataset.sceneFile = scene.name;
      if (scene.store) row.dataset.sceneStore = scene.store.id;
      row.setAttribute('role', 'option');
      const title = document.createElement('span');
      title.textContent = scenePickerTitle(scene);
      const meta = document.createElement('span');
      meta.className = 'scene-load-picker-meta';
      meta.textContent = [scene.store ? `from ${scene.store.label}` : '', scene.error ? `Unreadable: ${scene.error}` : scene.label || '', savedWhen(scene.timestamp)].filter(Boolean).join(' · ');
      row.append(title, meta);
      row.addEventListener('click', () => finish({ name: scene.name, store: scene.store || null }));
      return row;
    };
    let rows = ordered.map(makeRow);
    list.append(...rows);
    let open = true;
    let active = 0;
    const visible = () => rows.filter(row => !row.hidden);
    const highlight = () => {
      const shown = visible();
      active = Math.max(0, Math.min(active, shown.length - 1));
      rows.forEach(row => row.classList.remove('active'));
      shown[active]?.classList.add('active');
      shown[active]?.scrollIntoView({ block: 'nearest' });
      note.textContent = localPending ? 'Loading saved scene details…' : pending ? 'Loading scenes from other Kaminos servers…'
        : listingError || (rows.length ? (shown.length ? '' : 'No saved scene matches.') : 'No saved scenes yet. Cmd+S saves one.');
    };
    const finish = value => { open = false; backdrop.remove(); resolve(value); };
    const applyFilter = () => { ordered.forEach((scene, index) => { rows[index].hidden = !sceneMatchesFilter(scene, input.value); }); };
    input.addEventListener('input', () => { applyFilter(); active = 0; highlight(); });
    const refresh = next => {
      const current = visible()[active];
      const activeName = current?.dataset.sceneFile, activeStore = current?.dataset.sceneStore;
      ordered = sortScenesNewestFirst(next);
      rows = ordered.map(makeRow);
      list.replaceChildren(...rows);
      applyFilter();
      const previous = visible().findIndex(row => row.dataset.sceneFile === activeName && row.dataset.sceneStore === activeStore);
      if (previous >= 0) active = previous;
      highlight();
    };
    if (local) (async () => {
      try { for await (const entries of local) { if (!open) break; refresh([...entries, ...ordered.filter(scene => scene.store)]); } }
      catch (error) { listingError = `Saved scenes could not be listed: ${error.message || error}`; }
      finally { localPending = false; if (open) highlight(); }
    })();
    more?.then(extra => {
      if (!open) return;
      const added = sortScenesNewestFirst(extra || []);
      const addedRows = added.map(makeRow);
      ordered = [...ordered, ...added];
      rows = [...rows, ...addedRows];
      list.append(...addedRows);
    }).catch(error => { listingError = `Other saved scenes could not be listed: ${error.message || error}`; }).finally(() => { if (!open) return; pending = !!moreDetails; applyFilter(); highlight(); });
    moreDetails?.then(entries => { if (open) refresh([...ordered.filter(scene => !scene.store), ...entries]); })
      .catch(error => { listingError = `Other saved scene details could not be listed: ${error.message || error}`; })
      .finally(() => { pending = false; if (open) highlight(); });
    backdrop.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); active++; highlight(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); active--; highlight(); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = visible()[active];
        if (chosen) finish({ name: chosen.dataset.sceneFile, store: ordered[rows.indexOf(chosen)].store || null });
      }
    });
    backdrop.querySelector('[data-scene-browse]').addEventListener('click', () => finish('browse'));
    backdrop.querySelector('[data-scene-cancel]').addEventListener('click', () => finish(null));
    backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) finish(null); });
    host.appendChild(backdrop);
    highlight();
    input.focus();
  });
}
