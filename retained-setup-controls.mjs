export function mountRetainedSetupControls({document, root, title, read, remember, prepare, undo, redo, save, begin}) {
  const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const section = el('section'); section.className = 'retained-setup';
  const style = el('style', `.retained-setup{margin-top:12px;border-top:1px solid #50575d;padding-top:10px;display:grid;gap:8px;font:12px system-ui;min-width:0}.retained-setup button{background:#30383d;color:#e3ebee;border:1px solid #637078;border-radius:4px;padding:6px 9px;cursor:pointer}.retained-setup button:disabled{opacity:.5;cursor:default}.retained-setup-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.retained-setup [role=status]{color:#a9c6bc}.retained-setup [role=alert],.keep-setup-dialog [role=alert]{color:#ffada6;white-space:pre-wrap;overflow-wrap:anywhere}.keep-setup-dialog{color:#e3ebee;background:#20282d;border:1px solid #667d85;border-radius:6px;width:420px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);box-sizing:border-box;overflow:auto;padding:18px;font:13px system-ui}.keep-setup-dialog::backdrop{background:#0005}.keep-setup-dialog h3{font-size:16px;margin:0 0 12px}.keep-setup-dialog label{display:flex;align-items:center;gap:8px;padding:8px 0}.keep-setup-dialog details{margin:0 0 8px 24px;color:#adc4cd}.keep-setup-dialog pre{font:12px system-ui;white-space:pre-wrap;overflow-wrap:anywhere}.keep-setup-dialog button{background:#303b41;color:inherit;border:1px solid #677b84;border-radius:4px;padding:7px 12px}.keep-setup-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}`);
  style.textContent += '.keep-setup-dialog{position:fixed;inset:0;margin:auto}';
  section.append(style);
  const status = el('div'); status.setAttribute('role', 'status');
  const error = el('div'); error.setAttribute('role', 'alert');
  let busy = false, disposed = false, dialog = null;
  const buttons = [];
  const perform = async action => {
    if (busy || disposed) return;
    busy = true; error.textContent = ''; update();
    try { await action(); } catch (e) { error.textContent = e.message; }
    finally { busy = false; if (!disposed) update(); }
  };
  const button = (label, action, parent, enabled = () => true) => {
    const node = el('button', label); node.type = 'button'; node.onclick = () => perform(action);
    buttons.push({node, enabled}); parent.append(node); return node;
  };
  const hasSetup = () => Boolean(read());
  button('Keep in Setup', () => {
    const proposal = prepare(), first = proposal.preview(), choices = {};
    dialog?.remove(); dialog = el('dialog'); dialog.className = 'keep-setup-dialog';
    dialog.setAttribute('aria-label', `Keep in Setup: ${title}`);
    dialog.append(el('h3', `Keep in Setup: ${title}`));
    const feedback = el('div'); feedback.setAttribute('role', 'alert');
    const dependencies = el('p'), footer = el('footer');
    const cancel = el('button', 'Cancel'), commit = el('button', 'Keep'); cancel.type = commit.type = 'button';
    const close = () => { dialog?.close(); dialog?.remove(); dialog = null; };
    const refresh = () => {
      try { const p = proposal.preview(choices); dependencies.textContent = (p.dependencies ?? []).join('\n'); feedback.textContent = ''; commit.disabled = false; }
      catch (e) { feedback.textContent = e.message; commit.disabled = true; }
    };
    for (const group of first.groups) {
      choices[group.id] = group.checked;
      const label = el('label'), input = el('input'); input.type = 'checkbox'; input.checked = group.checked; input.onchange = () => { choices[group.id] = input.checked; refresh(); };
      label.append(input, el('span', group.label)); dialog.append(label);
      if (group.detail) { const detail = el('details'); detail.append(el('summary', `${group.label} details`), el('pre', group.detail)); dialog.append(detail); }
    }
    cancel.onclick = close; dialog.oncancel = event => { event.preventDefault(); close(); };
    commit.onclick = () => { try { proposal.commit(choices); close(); update(); } catch (e) { feedback.textContent = e.message; commit.disabled = true; } };
    footer.append(cancel, commit); dialog.append(dependencies, feedback, footer); document.body.append(dialog); refresh(); dialog.showModal();
  }, section, hasSetup);
  const details = el('details'), actions = el('div'); actions.className = 'retained-setup-actions';
  details.append(el('summary', 'Starting setup'), status, actions); section.append(details, error);
  button('Use current as setup', remember, actions);
  button('Begin again', () => begin(read().document), actions, hasSetup);
  button('Download setup', () => save(read().document), actions, hasSetup);
  button('Undo setup edit', undo, actions, () => read()?.undoCount > 0);
  button('Redo setup edit', redo, actions, () => read()?.redoCount > 0);
  function update() {
    const state = read(); status.textContent = state ? `${title} / setup revision ${state.revision}` : `${title} / starting setup unset`;
    for (const {node, enabled} of buttons) node.disabled = busy || !enabled();
  }
  root.append(section); update();
  return {update, dispose() { disposed = true; dialog?.remove(); section.remove(); }};
}

export function downloadSetup(document, value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
