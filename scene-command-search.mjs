// The menu renders existing operations. It does not own selection or edit history.
const textControl = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const interactive = `${textControl},button,a,summary,[role="button"],[role="treeitem"],[role="separator"],.scene-object-row,.scene-group-row,.scene-field-row`;
const normalize = value => String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

export function searchCommands(commands, query = '') {
  const words = normalize(query).split(' ').filter(Boolean);
  return commands.map((command, index) => {
    const label = normalize(command.label), haystack = normalize([command.category, command.label, ...(command.aliases || [])].join(' '));
    if (!words.every(word => haystack.includes(word))) return null;
    const phrase = normalize(query);
    const rank = !phrase ? 0 : label === phrase ? 0 : label.startsWith(phrase) ? 1 : label.includes(phrase) ? 2 : 3;
    return { command, index, rank };
  }).filter(Boolean).sort((a, b) => a.rank - b.rank || a.index - b.index).map(item => item.command);
}

export function commandSearchShortcut(event, { activeElement, viewport, hover }) {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if ([event.target, activeElement].some(node => node?.closest?.(textControl))) return false;
  if (event.key === 'F3') return true;
  if (event.code !== 'Space' && event.key !== ' ') return false;
  if ([event.target, activeElement].some(node => node?.closest?.(interactive))) return false;
  return !!(hover || (activeElement !== viewport.ownerDocument.body && viewport.contains(activeElement)));
}

export function installCommandSearch({ document, viewport, button, commands, blocked = () => null, onError = () => {} }) {
  const win = document.defaultView;
  const backdrop = document.createElement('div');
  backdrop.id = 'scene-command-search'; backdrop.hidden = true;
  backdrop.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="scene-command-title">
    <header><strong id="scene-command-title">Search commands</strong><button type="button" aria-label="Close command search">Esc</button></header>
    <input id="scene-command-query" type="search" placeholder="Search commands…" autocomplete="off" spellcheck="false" role="combobox" aria-label="Search commands" aria-expanded="true" aria-autocomplete="list" aria-controls="scene-command-results">
    <div id="scene-command-results" role="listbox" aria-label="Commands"></div><p id="scene-command-status" role="status"></p>
    <footer>↑ ↓ Choose <span>Enter Run</span><span>Esc Close</span><span>Space / F3 Search</span></footer></section>`;
  const style = document.createElement('style');
  style.textContent = `
#scene-command-search[hidden]{display:none}
#scene-command-search{position:fixed;inset:0;z-index:10010;display:flex;justify-content:center;align-items:flex-start;padding:clamp(48px,16vh,160px) 16px 24px;background:#0005;box-sizing:border-box;pointer-events:auto}
#scene-command-search section{width:500px;max-width:100%;max-height:100%;display:flex;flex-direction:column;background:#25282e;color:#eceef1;border:1px solid #555c68;border-radius:8px;box-shadow:0 14px 55px #0009;font:13px/1.4 system-ui,sans-serif;overflow:hidden}
#scene-command-search header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;color:#cbd0d9}
#scene-command-search header button{background:#343841;border:1px solid #525965;border-radius:4px;color:#cbd0d9;font:11px system-ui;padding:3px 6px;cursor:pointer}
#scene-command-search input{box-sizing:border-box;width:calc(100% - 24px);margin:0 12px 10px;padding:10px 12px;border:1px solid #7f9ac4;border-radius:4px;background:#16191e;color:#fff;font:15px system-ui;outline:2px solid #80b5ff33}
#scene-command-results{color-scheme:dark;overflow:auto;min-height:40px;max-height:45vh;border-block:1px solid #3c424c;padding:4px}
#scene-command-results [role=option]{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:3px;cursor:pointer;min-height:20px}
#scene-command-results [aria-selected=true]{background:#395a87;color:white}
#scene-command-results [aria-disabled=true]{color:#949ba7}
#scene-command-results .command-label{flex:1;min-width:0}
#scene-command-results .command-category{font-size:11px;color:#aeb6c4;margin-right:7px}
#scene-command-results kbd{font:11px system-ui;white-space:nowrap;color:#c3ccda}
#scene-command-search p{margin:8px 14px;color:#b7c1d1;font-size:12px;min-height:17px}
#scene-command-search footer{display:flex;flex-wrap:wrap;gap:14px;padding:9px 14px;background:#1e2126;font-size:11px;color:#adb5c3}
`;
  document.head.append(style); document.body.append(backdrop);
  const input = backdrop.querySelector('input'), results = backdrop.querySelector('[role=listbox]'), status = backdrop.querySelector('[role=status]');
  let opened = false, hover = false, previousFocus = null, matches = [], selected = 0, swallowRelease = false;
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const reason = command => command.disabled?.() || null;
  const catalogue = () => commands();
  function select(index, scroll = false) {
    selected = index;
    [...results.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === index)));
    const row = results.children[index];
    if (row) input.setAttribute('aria-activedescendant', row.id); else input.removeAttribute('aria-activedescendant');
    status.textContent = reason(matches[index] || {}) || `${matches.length} ${matches.length === 1 ? 'command' : 'commands'}`;
    if (scroll) row?.scrollIntoView({ block: 'nearest' });
  }
  function render() {
    matches = searchCommands(catalogue(), input.value);
    results.replaceChildren();
    matches.forEach((command, index) => {
      const row = document.createElement('div'); row.id = `scene-command-result-${index}`; row.setAttribute('role', 'option'); row.dataset.command = command.id;
      const unavailable = reason(command); row.setAttribute('aria-disabled', String(!!unavailable)); if (unavailable) row.title = unavailable;
      const label = document.createElement('span'); label.className = 'command-label';
      const category = document.createElement('span'); category.className = 'command-category'; category.textContent = command.category;
      label.append(category, document.createTextNode(command.label)); row.append(label);
      if (command.shortcut) { const key = document.createElement('kbd'); key.textContent = command.shortcut; row.append(key); }
      row.addEventListener('pointermove', () => select(index));
      row.addEventListener('pointerdown', event => event.preventDefault()); // Keep the combobox keyboard owner.
      row.addEventListener('click', () => choose(command.id)); results.append(row);
    });
    select(Math.max(0, matches.findIndex(command => !reason(command))));
    if (!matches.length) status.textContent = 'No matching commands';
  }
  function close({ restoreFocus = true } = {}) {
    if (!opened) return;
    opened = false; backdrop.hidden = true; input.blur(); button?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    else if (!restoreFocus) { viewport.tabIndex = viewport.tabIndex < 0 ? -1 : viewport.tabIndex; viewport.focus({ preventScroll: true }); }
  }
  function open() {
    if (opened) { input.focus(); return true; }
    const unavailable = blocked();
    if (unavailable) { onError(new Error(unavailable)); return false; }
    previousFocus = document.activeElement; opened = true; backdrop.hidden = false; button?.setAttribute('aria-expanded', 'true');
    input.value = ''; render(); input.focus({ preventScroll: true }); return true;
  }
  function run(id) {
    const command = catalogue().find(item => item.id === id);
    if (!command) throw new Error(`Unknown command: ${id}`);
    const unavailable = blocked() || reason(command);
    if (unavailable) throw new Error(unavailable);
    return command.run();
  }
  function choose(id) {
    try {
      // Revalidate after typing; callers may have changed state while this menu was open.
      const command = catalogue().find(item => item.id === id), unavailable = blocked() || (command && reason(command));
      if (!command) throw new Error(`Unknown command: ${id}`);
      if (unavailable) { render(); status.textContent = unavailable; return; }
      close({ restoreFocus: false });
      const result = run(id);
      if (result?.catch) result.catch(onError);
    } catch (error) { onError(error); }
  }
  input.addEventListener('input', render);
  backdrop.querySelector('button').onclick = () => close();
  if (button) { button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false'); button.onclick = open; }
  viewport.addEventListener('pointerenter', () => hover = true);
  viewport.addEventListener('pointerleave', () => hover = false);
  // Window capture precedes the existing document-level modal/key handlers.
  win.addEventListener('keydown', event => {
    if (opened) {
      event.stopImmediatePropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape' || (event.key === 'Enter' && document.activeElement === backdrop.querySelector('button'))) { event.preventDefault(); close(); }
      else if (event.key === 'Enter') { event.preventDefault(); if (matches[selected]) choose(matches[selected].id); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (matches.length) select((selected + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length, true); }
      else if (event.key === 'Tab') { event.preventDefault(); if (document.activeElement === input && !event.shiftKey) backdrop.querySelector('button').focus(); else input.focus(); }
      return;
    }
    if (!commandSearchShortcut(event, { activeElement: document.activeElement, viewport, hover })) return;
    // Guarded gestures keep the event: search never takes their keyboard owner.
    if (blocked()) return;
    consume(event); open();
  }, true);
  win.addEventListener('keyup', event => { if (opened) event.stopImmediatePropagation(); }, true);
  win.addEventListener('pointerdown', event => {
    if (opened && event.target === backdrop) { consume(event); swallowRelease = true; close(); }
  }, true);
  for (const type of ['pointerup', 'click', 'pointercancel']) win.addEventListener(type, event => {
    if (!swallowRelease) return; consume(event); if (type !== 'pointerup') swallowRelease = false;
  }, true);
  win.addEventListener('blur', () => { close({ restoreFocus: false }); swallowRelease = false; });
  document.addEventListener('kaminos-workspace-change', () => close());
  return { open, close, run, search: query => searchCommands(catalogue(), query).map(command => ({ id: command.id, category: command.category, label: command.label, shortcut: command.shortcut || null, disabled: reason(command) })), state: () => ({ open: opened, query: input.value, selected: matches[selected]?.id ?? null, count: matches.length }) };
}
