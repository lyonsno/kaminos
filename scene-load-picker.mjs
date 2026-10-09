// Saved-scene picker for Load. It renders scene-catalog groups (one per scene
// identity, decided by the server) and never decides on its own which scenes
// are the same. Scenes with a copy here list first, then newest first. Type to
// narrow, arrows to move, Enter or a click to open, Escape to close. "Browse
// files…" falls back to the system file picker.
//
// pickSavedScene({ groups, more }): `groups` show at once (this server's
// catalog); `more`, a promise of the full catalog including other servers,
// replaces them when it arrives. Resolves the chosen group, 'browse', or null.

// One catalog group as a picker entry.
export function catalogEntry(group) {
  const primary = group.local[0] ? { name: group.local[0], store: null } : { name: group.foreign[0]?.name, store: group.foreign[0] || null };
  const servers = [...new Set(group.foreign.map(member => member.storeLabel))];
  return {
    group,
    key: group.identity || `unreadable:${primary.name}`,
    name: primary.name,
    label: group.label,
    timestamp: group.timestamp,
    here: group.local.length > 0,
    servers,
    copies: group.copies || 0,
    image: group.image ? `/api/scene-image?${new URLSearchParams({ store: group.image.store, name: group.image.name })}` : null,
  };
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => Number(!a.here) - Number(!b.here)
    || String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || String(a.name).localeCompare(String(b.name)));
}

export function entryMatchesFilter(entry, filter) {
  const words = String(filter || '').toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${entry.label || ''} ${entry.name} ${entry.servers.join(' ')}`.toLowerCase();
  return words.every(word => haystack.includes(word));
}

function savedWhen(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function entryMeta(entry) {
  return [
    !entry.here && entry.servers.length ? `from ${entry.servers[0]}` : '',
    entry.here && entry.servers.length ? `meshes from ${entry.servers.join(', ')}` : '',
    entry.copies ? `+${entry.copies} identical cop${entry.copies === 1 ? 'y' : 'ies'}` : '',
    String(entry.name || '').replace(/\.kaminos\.json$/, ''),
    savedWhen(entry.timestamp),
  ].filter(Boolean).join(' · ');
}

export function pickSavedScene({ groups, more = null, host = document.body } = {}) {
  return new Promise(resolve => {
    let entries = sortEntries(groups.map(catalogEntry));
    let pending = !!more, moreError = '', open = true;
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
    const finish = value => { open = false; backdrop.remove(); resolve(value); };
    const makeRow = entry => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'scene-load-picker-row';
      row.dataset.sceneFile = entry.name;
      if (!entry.here && entry.group.foreign[0]) row.dataset.sceneStore = entry.group.foreign[0].store;
      row.setAttribute('role', 'option');
      const picture = document.createElement('span');
      picture.className = 'scene-load-picker-thumb';
      if (entry.image) {
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.alt = '';
        image.src = entry.image;
        image.addEventListener('error', () => image.remove());
        picture.append(image);
      }
      const text = document.createElement('span');
      text.className = 'scene-load-picker-text';
      const title = document.createElement('span');
      title.textContent = entry.label || String(entry.name || '').replace(/\.kaminos\.json$/, '');
      const meta = document.createElement('span');
      meta.className = 'scene-load-picker-meta';
      meta.textContent = entryMeta(entry);
      text.append(title, meta);
      row.append(picture, text);
      row.addEventListener('click', () => finish(entry.group));
      return row;
    };
    let rows = [];
    let active = 0;
    const visible = () => rows.filter(row => !row.hidden);
    const highlight = () => {
      const shown = visible();
      active = Math.max(0, Math.min(active, shown.length - 1));
      rows.forEach(row => row.classList.remove('active'));
      shown[active]?.classList.add('active');
      shown[active]?.scrollIntoView({ block: 'nearest' });
      note.textContent = pending ? 'Loading scenes from other Kaminos servers…'
        : moreError ? `Could not list other servers' scenes: ${moreError}`
        : rows.length ? (shown.length ? '' : 'No saved scene matches.') : 'No saved scenes yet. Cmd+S saves one.';
    };
    const applyFilter = () => { entries.forEach((entry, index) => { rows[index].hidden = !entryMatchesFilter(entry, input.value); }); };
    const render = () => {
      rows = entries.map(makeRow);
      list.replaceChildren(...rows);
      applyFilter();
      highlight();
    };
    input.addEventListener('input', () => { applyFilter(); active = 0; highlight(); });
    more?.then(full => {
      if (!open) return;
      const chosenKey = visible()[active] ? entries[rows.indexOf(visible()[active])]?.key : null;
      entries = sortEntries(full.map(catalogEntry));
      render();
      const keep = chosenKey ? visible().findIndex(row => entries[rows.indexOf(row)].key === chosenKey) : -1;
      if (keep > 0) { active = keep; highlight(); }
    }).catch(error => { moreError = error?.message || String(error); }).finally(() => { if (!open) return; pending = false; highlight(); });
    backdrop.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); active++; highlight(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); active--; highlight(); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = visible()[active];
        if (chosen) finish(entries[rows.indexOf(chosen)].group);
      }
    });
    backdrop.querySelector('[data-scene-browse]').addEventListener('click', () => finish('browse'));
    backdrop.querySelector('[data-scene-cancel]').addEventListener('click', () => finish(null));
    backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) finish(null); });
    host.appendChild(backdrop);
    render();
    input.focus();
  });
}
