// One live set of controls, projected into two workspaces. Slots retain node,
// listener, and value identity; no second scene model or simulation lifecycle.
export function createControlSlots(document, entries) {
  const slots = entries.map(({ node, destination }) => {
    if (!node || !destination) throw new Error('Workspace control or destination is missing');
    const marker = document.createComment(`workspace:${node.id || node.tagName}`);
    node.before(marker);
    return { node, destination, marker };
  });
  return {
    showAuthoring() { for (const { node, destination } of slots) destination.append(node); },
    showWorkbench() { for (const { node, marker } of slots) marker.after(node); },
  };
}

export function installAuthoringWorkspace({ document, initialMode = 'workbench', beforeSwitch = () => true, openWorkbenchTab, edits }) {
  const byId = id => document.getElementById(id);
  const header = document.createElement('header');
  header.id = 'authoring-header';
  header.innerHTML = `<strong class="authoring-brand">Kaminos</strong>
    <nav class="workspace-switch" aria-label="Workspace"><button type="button" data-workspace-mode="authoring">Authoring</button><button type="button" data-workspace-mode="workbench">Workbench</button></nav>
    <div id="authoring-document-actions" aria-label="Document commands"></div>
    <div class="authoring-header-spacer"></div>
    <button type="button" data-workbench-tab="assets" title="Import assets and browse the full workbench">Assets</button>
    <button type="button" data-workbench-tab="generate">Generate</button>`;
  const hierarchy = document.createElement('aside');
  hierarchy.id = 'authoring-hierarchy'; hierarchy.setAttribute('aria-label', 'Scene hierarchy');
  hierarchy.innerHTML = `<div class="authoring-panel-heading"><h2>Scene</h2><span id="authoring-object-count"></span></div><div id="authoring-tree"></div><div class="authoring-hierarchy-bottom"><p>Click to select · Double-click name to rename · × removes (Undo restores)</p></div>`;
  const inspector = document.createElement('aside');
  inspector.id = 'authoring-inspector'; inspector.setAttribute('aria-label', 'Properties');
  inspector.innerHTML = `<nav class="inspector-switch" aria-label="Properties context"><button type="button" data-inspector-context="object" aria-pressed="true">Selection</button><button type="button" data-inspector-context="scene" aria-pressed="false">Scene</button></nav>
    <div id="authoring-object-properties" class="authoring-inspector-body"><div id="authoring-transform-slot"></div><div id="authoring-type-slot"></div><details id="authoring-object-tools"><summary>Object tools</summary></details></div>
    <div id="authoring-scene-properties" class="authoring-inspector-body" hidden><h2>Composition</h2><div class="scene-data-choices"><button type="button" id="scene-fire-data">Fire & smoke data</button><button type="button" id="scene-water-data">Water simulation data</button></div><div id="authoring-composition-slot"></div><details open id="authoring-world-slot"><summary>Environment</summary></details><div id="authoring-water-slot"></div><details id="authoring-render-slot"><summary>Rendering</summary></details></div>`;
  const toolbar = document.createElement('div'); toolbar.id = 'authoring-viewport-tools';
  toolbar.innerHTML = `<div id="authoring-add-slot"></div><details id="authoring-presets"><summary>Presets</summary><div><button type="button" id="apply-burner-preset">Burner setup</button><p>Apply to the current fire field</p></div></details><div id="authoring-gizmo-slot" aria-label="Transform gizmo"></div><details id="authoring-viewport-settings"><summary>Viewport</summary><div><label><input id="viewport-show-gizmos" type="checkbox" checked> Transform gizmos</label><label><input id="viewport-show-hints" type="checkbox" checked> Navigation hints</label><label><input id="viewport-show-emitter-guides" type="checkbox" checked> Emitter wireframes</label><div class="field viewport-guide-opacity"><label for="viewport-emitter-opacity">Emitter opacity</label><input id="viewport-emitter-opacity" class="transform-input" type="number" min="0" max="1" step="any" data-authoring-drag-step="0.01" value="0.55"></div></div></details><div class="authoring-header-spacer"></div><button type="button" id="authoring-frame" title="Frame selected (F)">Frame</button><button type="button" id="authoring-undo" title="Undo (Cmd/Ctrl Z)">Undo</button><button type="button" id="authoring-redo" title="Redo (Cmd/Ctrl Shift Z)">Redo</button><div id="authoring-navigation-slot"></div>`;
  document.body.prepend(header);
  document.body.append(hierarchy, inspector);
  byId('viewport').prepend(toolbar);
  const viewportSettings=byId('authoring-viewport-settings');
  document.addEventListener('pointerdown',event=>{
    if(!viewportSettings.contains(event.target))viewportSettings.open=false;
    if(!byId('authoring-presets').contains(event.target))byId('authoring-presets').open=false;
  },true);
  for(const [id,key] of [['viewport-show-gizmos','gizmos'],['viewport-show-hints','hints'],['viewport-show-emitter-guides','emitterGuides']])byId(id).addEventListener('change',event=>document.defaultView.kaminosViewportSettings.set({[key]:event.target.checked}));
  const opacity=byId('viewport-emitter-opacity');
  opacity.addEventListener('input',()=>{if(opacity.value!==''&&opacity.validity.valid)document.defaultView.kaminosViewportSettings.set({emitterGuideOpacity:Number(opacity.value)});});
  opacity.addEventListener('change',()=>{opacity.value=String(document.defaultView.kaminosViewportSettings.read().emitterGuideOpacity);});
  byId('apply-burner-preset').onclick=()=>{try{document.defaultView.kaminosApplyBurnerPreset();byId('authoring-presets').open=false;}catch(error){byId('info-bar').textContent=error.message;}};
  byId('scene-fire-data').onclick=()=>document.defaultView.selectSceneField('flame-field');
  byId('scene-water-data').onclick=()=>document.defaultView.selectSceneField('water-field');
  const entries = [];
  const move = (node, destination) => entries.push({ node, destination: byId(destination) });
  move(byId('scene-object-list').closest('.panel'), 'authoring-tree');
  move(byId('transform-inspector'), 'authoring-transform-slot');
  move(byId('selected-light-properties'), 'authoring-type-slot');
  move(byId('selected-flame-properties'), 'authoring-type-slot');
  move(byId('selected-bed-properties'), 'authoring-type-slot');
  move(byId('shared-flame-domain-properties'), 'authoring-type-slot');
  move(byId('selected-mesh-properties'), 'authoring-type-slot');
  move(byId('selected-spot-properties'), 'authoring-type-slot');
  move(byId('selected-object-relations'), 'authoring-type-slot');
  move(byId('selected-group-properties'), 'authoring-type-slot');
  move(byId('selected-assembly-properties'), 'authoring-type-slot');
  move(byId('exposure-slider').closest('.slider-row'), 'scene-camera-host-exposure');
  move(byId('scene-camera-match-row'), 'scene-camera-controls');
  move(byId('authoring-source-environment'), 'authoring-world-slot');
  move(byId('authoring-source-render'), 'authoring-render-slot');
  move(byId('authoring-source-fire-light'), 'scene-lighting-comparison');
  const renderingPanel=byId('rendering-panel-content');
  if(renderingPanel)move(renderingPanel,'authoring-render-slot');
  let workbenchRenderingHidden=renderingPanel?.hidden;
  move(byId('local-liquid-performance'), 'authoring-type-slot');
  move(byId('composition-label').closest('.authoring-controls'), 'authoring-composition-slot');
  move(byId('scene-add-menu').closest('nav'), 'authoring-add-slot');
  move(byId('navigation-input-mode').closest('label'), 'authoring-navigation-slot');
  // Child slots precede their parent slot so restoring is independent of order.
  for (const button of document.querySelectorAll('#transform-bar > button')) {
    const action = button.getAttribute('onclick') || '';
    if (/saveScene|scene-file-input/.test(action)) move(button, 'authoring-document-actions');
    else if (/setGizmoMode/.test(action)) move(button, 'authoring-gizmo-slot');
  }
  move(byId('composition-capture'), 'authoring-document-actions');
  move(byId('transform-bar'), 'authoring-object-tools');
  const slots = createControlSlots(document, entries);
  let mode = null;
  function setContext(context) {
    const object = context === 'object';
    byId('authoring-object-properties').hidden = !object;
    byId('authoring-scene-properties').hidden = object;
    inspector.querySelectorAll('[data-inspector-context]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.inspectorContext === context)));
  }
  function setMode(next) {
    if (!['authoring', 'workbench'].includes(next)) throw new Error('Unknown workspace');
    if (mode === next) return true;
    if (beforeSwitch(next) === false) return false;
    // Blurring commits a normal field edit through its existing handler.
    document.activeElement?.blur?.();
    if (next === 'authoring') {
      if(renderingPanel)workbenchRenderingHidden=renderingPanel.hidden;
      slots.showAuthoring();if(renderingPanel)renderingPanel.hidden=false;
    } else {
      slots.showWorkbench();if(renderingPanel)renderingPanel.hidden=workbenchRenderingHidden;
    }
    mode = next;
    document.body.dataset.workspace = mode;
    header.querySelectorAll('[data-workspace-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === mode)));
    return true;
  }
  header.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.workspaceMode)));
  header.querySelectorAll('[data-workbench-tab]').forEach(button => button.addEventListener('click', () => { if (setMode('workbench')) openWorkbenchTab(button.dataset.workbenchTab); }));
  inspector.querySelectorAll('[data-inspector-context]').forEach(button => button.addEventListener('click', () => setContext(button.dataset.inspectorContext)));
  byId('authoring-frame').onclick = () => { document.defaultView.kaminosFrameSelected?.(); byId('authoring-frame').blur(); };
  for (const action of ['undo', 'redo']) byId(`authoring-${action}`).onclick = () => {
    try { edits[action](); } catch (error) { byId('info-bar').textContent = error.message; }
    byId(`authoring-${action}`).blur();
  };
  const updateHistory = () => {
    const state = edits.state();
    byId('authoring-undo').disabled = !!state.active || state.replaying || !state.undoCount;
    byId('authoring-redo').disabled = !!state.active || state.replaying || !state.redoCount;
  };
  edits.subscribe(updateHistory); updateHistory();
  // Selection already has a canonical inspector projection. Observe only its
  // identity, never write scene selection from layout code.
  const Observer = document.defaultView.MutationObserver;
  let selectionKey;
  const observer = new Observer(() => {
    const source = byId('transform-inspector');
    const key = `${source.dataset.selectedObjectId}/${source.dataset.selectedGroupId}/${source.dataset.selectedFieldId}`;
    if (key === selectionKey) return;
    selectionKey = key;
    byId('authoring-object-tools').hidden=!!source.dataset.selectedFieldId;
    setContext('object');

  });
  observer.observe(byId('transform-inspector'), { attributes: true, attributeFilter: ['data-selected-object-id', 'data-selected-group-id','data-selected-field-id'] });
  const updateCount = () => {
    const count = byId('scene-object-list').querySelectorAll('[data-scene-object-id]').length;
    byId('authoring-object-count').textContent = `${count} ${count === 1 ? 'object' : 'objects'}`;
  };
  const treeObserver = new Observer(updateCount);
  treeObserver.observe(byId('scene-object-list'), { childList: true }); updateCount();

  // Native splitters change viewport geometry; existing ResizeObserver owns
  // camera aspect and render targets.
  for (const [side, label] of [['left', 'Scene hierarchy width'], ['right', 'Properties width']]) {
    const splitter = document.createElement('div'); splitter.className = `authoring-splitter ${side}`;
    splitter.tabIndex = 0; splitter.setAttribute('role', 'separator'); splitter.setAttribute('aria-label', label); splitter.setAttribute('aria-orientation', 'vertical');
    document.body.append(splitter);
    const panel = side === 'left' ? hierarchy : inspector;
    const resize = value => { const width = Math.max(180, Math.min(document.body.clientWidth * .4, value)); document.body.style.setProperty(`--authoring-${side}`, `${width}px`); splitter.setAttribute('aria-valuenow', String(Math.round(width))); };
    splitter.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); resize(panel.clientWidth + (event.key === 'ArrowRight' ? 10 : -10) * (side === 'left' ? 1 : -1)); } });
    let drag;
    splitter.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); drag = { x: event.clientX, width: panel.clientWidth }; splitter.setPointerCapture(event.pointerId); });
    splitter.addEventListener('pointermove', event => { if (drag) resize(drag.width + (event.clientX - drag.x) * (side === 'left' ? 1 : -1)); });
    splitter.addEventListener('pointerup', () => { drag = null; }); splitter.addEventListener('pointercancel', () => { drag = null; });
  }
  document.body.classList.add('has-authoring-workspace');
  setMode(initialMode);
  return { setMode, setContext, state: () => ({ mode, context: byId('authoring-object-properties').hidden ? 'scene' : 'object' }) };
}
