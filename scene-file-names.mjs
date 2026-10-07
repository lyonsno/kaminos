// File names chosen by the author for Save As and GLB export. The stem keeps
// letters, digits, dot, underscore and dash (whitespace becomes a dash), the
// same rule the server applies to scene names.
export function sanitizeFileStem(value, extension = '') {
  let stem = String(value ?? '').trim().split(/[\\/]/).pop();
  if (extension && stem.toLowerCase().endsWith(extension.toLowerCase())) stem = stem.slice(0, -extension.length);
  stem = stem.split(/\s+/).filter(Boolean).join('-');
  stem = stem.replace(/[^A-Za-z0-9._-]/g, '').replace(/^[.-]+|[.-]+$/g, '');
  return stem.slice(0, 120);
}

// A small in-page name dialog: Enter or Save confirms, Escape or Cancel
// declines. Resolves to the sanitized stem, or null when declined. `message`
// explains a re-prompt (for example a name that already exists) and
// `confirmLabel` renames the confirm button for it.
export function promptForFileName({ title, defaultStem = '', extension = '', message = '', confirmLabel = 'Save', host = document.body } = {}) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'file-name-prompt';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML = `
      <form class="file-name-prompt-panel">
        <div class="file-name-prompt-title"></div>
        <label class="file-name-prompt-row"><input type="text" spellcheck="false" autocomplete="off"><span class="file-name-prompt-ext"></span></label>
        <div class="file-name-prompt-message" role="status"></div>
        <div class="file-name-prompt-actions"><button type="button" data-file-name-cancel>Cancel</button><button type="submit" data-file-name-confirm></button></div>
      </form>`;
    const form = backdrop.querySelector('form'), input = backdrop.querySelector('input');
    const note = backdrop.querySelector('.file-name-prompt-message');
    backdrop.querySelector('.file-name-prompt-title').textContent = title;
    backdrop.querySelector('.file-name-prompt-ext').textContent = extension;
    backdrop.querySelector('[data-file-name-confirm]').textContent = confirmLabel;
    note.textContent = message;
    input.value = sanitizeFileStem(defaultStem, extension);
    const finish = value => {
      backdrop.remove();
      resolve(value);
    };
    form.addEventListener('submit', event => {
      event.preventDefault();
      const stem = sanitizeFileStem(input.value, extension);
      if (!stem) { note.textContent = 'Use letters, digits, dot, dash or underscore.'; input.focus(); return; }
      finish(stem);
    });
    backdrop.querySelector('[data-file-name-cancel]').addEventListener('click', () => finish(null));
    // Keys stay inside the dialog so scene shortcuts (G, R, S, X, Delete) do not fire while typing.
    backdrop.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
    });
    backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) finish(null); });
    host.appendChild(backdrop);
    input.focus();
    input.select();
  });
}
