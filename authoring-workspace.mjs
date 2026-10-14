import {installRelativeNumberDrag} from './scene-control-history.mjs';
import {viewportShortcut} from './viewport-display-settings.mjs';
// One live set of controls, projected into two workspaces. Slots retain node,
// listener, and value identity; no second scene model or simulation lifecycle.
export function createControlSlots(document, entries) {
  const slots = entries.map(({ node, destination, workbenchDestination = null }) => {
    if (!node || !destination) throw new Error('Workspace control or destination is missing');
    const marker = document.createComment(`workspace:${node.id || node.tagName}`);
    node.before(marker);
    return { node, destination, workbenchDestination, marker };
  });
  const setActive = active => {
    for (const { node, destination, marker, workbenchDestination } of slots) {
      if (active) destination.append(node);
      else if (workbenchDestination) workbenchDestination.append(node);
      else marker.after(node);
    }
  };
  return { setActive, showAuthoring: () => setActive(true), showWorkbench: () => setActive(false) };
}

export function installAuthoringWorkspace({ document, initialMode = 'workbench', beforeSwitch = () => true, afterSwitch = () => {}, openWorkbenchTab, edits }) {
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
    <div id="authoring-camera-properties" class="authoring-inspector-body" hidden></div>
    <div id="authoring-object-properties" class="authoring-inspector-body"><div id="authoring-transform-slot"></div><div id="authoring-type-slot"></div><details id="authoring-object-tools"><summary>Object tools</summary></details></div>
    <div id="authoring-scene-properties" class="authoring-inspector-body" hidden><details id="authoring-inspector-scene-tree" hidden><summary>Scene objects</summary><div id="authoring-inspector-tree-slot"></div></details><h2>Composition</h2><div class="scene-data-choices"><button type="button" id="scene-fire-data">Fire & smoke data</button><button type="button" id="scene-water-data">Water simulation data</button></div><div id="authoring-composition-slot"></div><details open id="authoring-world-slot"><summary>Environment</summary></details><div id="authoring-water-slot"></div><details id="authoring-render-slot"><summary>Rendering</summary></details></div>`;
  const toolbar = document.createElement('div'); toolbar.id = 'authoring-viewport-tools';
  toolbar.innerHTML = `<div id="authoring-add-slot"></div><details id="authoring-presets"><summary>Presets</summary><div><button type="button" id="apply-burner-preset">Burner setup</button><p>Apply to the current fire field</p></div></details><label class="selection-setting">Axes <select id="selection-orientation"><option value="world">World</option><option value="local">Local</option></select></label><label class="selection-setting">Pivot <select id="selection-pivot"><option value="median">Median</option><option value="active">Active</option><option value="individual">Individual origins</option></select></label><div id="authoring-gizmo-slot" aria-label="Transform gizmo"></div><div id="authoring-shading-slot"></div><details id="authoring-viewport-settings"><summary>Viewport</summary><div><label title="Shift+Alt+Z"><input id="viewport-show-overlays" type="checkbox" checked> Overlays <small>Shift Alt Z</small></label><label title="Ctrl+tilde"><input id="viewport-show-gizmos" type="checkbox" checked> Transform gizmos <small>Ctrl ~</small></label><fieldset class="viewport-display-group"><legend><label><input id="viewport-show-outlines" type="checkbox" checked> Object outlines</label></legend><label>Width <input id="viewport-outlineWidth" class="transform-input" type="number" min=".5" max="8" step=".25" value="1.5"></label><label>Opacity <input id="viewport-outlineOpacity" class="transform-input" type="number" min="0" max="1" step=".05" value="1"></label><label><input id="viewport-show-bounds" type="checkbox"> Bounding boxes</label></fieldset><fieldset class="viewport-display-group"><legend><label><input id="viewport-show-domains" type="checkbox" checked> Simulation boundaries</label></legend><label>Width <input id="viewport-domainWidth" class="transform-input" type="number" min=".5" max="8" step=".25" value="1"></label><label>Opacity <input id="viewport-domainOpacity" class="transform-input" type="number" min="0" max="1" step=".05" value=".82"></label></fieldset><fieldset class="viewport-display-group"><legend><label><input id="viewport-show-emitters" type="checkbox" checked> Emitter symbols</label></legend><label>Width <input id="viewport-emitterWidth" class="transform-input" type="number" min=".5" max="8" step=".25" value="1"></label><label>Opacity <input id="viewport-emitterOpacity" class="transform-input" type="number" min="0" max="1" step=".05" value=".55"></label></fieldset><label><input id="viewport-show-helpers" type="checkbox" checked> Show helpers</label><label><input id="viewport-show-hints" type="checkbox" checked> Navigation hints</label></div></details><div class="authoring-header-spacer"></div><button type="button" id="authoring-box">Box · B</button><button type="button" id="authoring-duplicate">Duplicate</button><button type="button" id="authoring-delete">Delete</button><button type="button" id="authoring-frame" title="Frame selected (F)">Frame</button><button type="button" id="authoring-undo" title="Undo (Cmd/Ctrl Z)">Undo</button><button type="button" id="authoring-redo" title="Redo (Cmd/Ctrl Shift Z)">Redo</button><div id="authoring-navigation-slot"></div>`;
  document.body.prepend(header);
  document.body.append(hierarchy, inspector);
  byId('viewport').prepend(toolbar);
  const shot=document.createElement('details');shot.id='scene-camera-settings';shot.open=true;shot.innerHTML='<summary>Camera &amp; output</summary>';shot.append(byId('authoring-camera-properties'));byId('authoring-composition-slot').after(shot);
  const cameraButton=document.createElement('button');cameraButton.type='button';cameraButton.id='authoring-camera';cameraButton.textContent='Camera';cameraButton.onclick=()=>{setContext('scene');shot.open=true;shot.scrollIntoView({block:'nearest'});};byId('authoring-frame').before(cameraButton);
  const viewportSettings=byId('authoring-viewport-settings');
  document.addEventListener('pointerdown',event=>{
    if(!viewportSettings.contains(event.target))viewportSettings.open=false;
    if(!byId('authoring-presets').contains(event.target))byId('authoring-presets').open=false;
  },true);
  for(const key of ['overlays','gizmos','outlines','bounds','helpers','domains','emitters','hints'])byId('viewport-show-'+key).addEventListener('change',event=>document.defaultView.kaminosViewportSettings.set({[key]:event.target.checked}));
  for(const key of ['outlineWidth','outlineOpacity','domainWidth','domainOpacity','emitterWidth','emitterOpacity']){
    const input=byId('viewport-'+key),api=document.defaultView.kaminosViewportSettings;let before;
    const start=()=>{before=api.read()[key];};input.addEventListener('focusin',start);
    input.addEventListener('input',()=>{if(!Number.isFinite(input.valueAsNumber))return;try{api.set({[key]:input.valueAsNumber});}catch{}});
    input.addEventListener('change',()=>{input.value=String(api.read()[key]);});
    input.addEventListener('pointercancel',()=>{if(before!==undefined){api.set({[key]:before});input.value=String(before);}});
    installRelativeNumberDrag({input,grip:input,step:Number(input.step),onStart:start});
  }
  let viewportPointerInside=false;
  byId('viewport').addEventListener('pointerenter',()=>viewportPointerInside=true);
  byId('viewport').addEventListener('pointerleave',()=>viewportPointerInside=false);
  document.addEventListener('keydown',event=>{const key=viewportShortcut(event);if(!key||!viewportPointerInside||event.target.closest?.('input,textarea,select,[contenteditable="true"]')||document.querySelector('.file-name-prompt'))return;event.preventDefault();event.stopImmediatePropagation();const api=document.defaultView.kaminosViewportSettings,current=api.read();api.set({[key]:key==='shading'?(current.shading==='wireframe'?'solid':'wireframe'):!current[key]});},true);

  for(const [id,key] of [['selection-orientation','orientation'],['selection-pivot','pivot']])byId(id).onchange=event=>{document.defaultView.kaminosSelection.settings({[key]:event.target.value});event.target.blur();};
  for(const [id,action] of [['authoring-box','box'],['authoring-duplicate','duplicate'],['authoring-delete','remove']])byId(id).onclick=()=>{try{document.defaultView.kaminosSelection[action]();}catch(error){byId('info-bar').textContent=error.message;}byId(id).blur();};
  document.querySelector('[data-scene-group-create]').textContent='Group selection';
  byId('apply-burner-preset').onclick=()=>{try{document.defaultView.kaminosApplyBurnerPreset();byId('authoring-presets').open=false;}catch(error){byId('info-bar').textContent=error.message;}};
  byId('scene-fire-data').onclick=()=>document.defaultView.selectSceneField('flame-field');
  byId('scene-water-data').onclick=()=>document.defaultView.selectSceneField('water-field');
  const entries = [];
  const move = (node, destination) => entries.push({ node, destination: byId(destination),
    workbenchDestination: destination === 'authoring-document-actions' ? byId(destination) : null });
  move(byId('scene-object-list').closest('.panel'), 'authoring-tree');
  move(byId('transform-inspector'), 'authoring-transform-slot');
  move(byId('selected-light-properties'), 'authoring-type-slot');
  move(byId('selected-flame-properties'), 'authoring-type-slot');
  if(byId('selected-water-properties'))move(byId('selected-water-properties'), 'authoring-type-slot');
  move(byId('selected-bed-properties'), 'authoring-type-slot');
  move(byId('shared-flame-domain-properties'), 'authoring-type-slot');
  move(byId('selected-mesh-properties'), 'authoring-type-slot');
  move(byId('selected-spot-properties'), 'authoring-type-slot');
  move(byId('selected-collision-properties'), 'authoring-type-slot');
  move(byId('selected-object-relations'), 'authoring-type-slot');
  move(byId('selected-group-properties'), 'authoring-type-slot');
  move(byId('selected-assembly-properties'), 'authoring-type-slot');
  move(byId('authoring-source-environment'), 'authoring-world-slot');
  move(byId('authoring-source-render'), 'authoring-render-slot');
  move(byId('authoring-source-fire-light'), 'authoring-render-slot');
  const renderingPanel=byId('rendering-panel-content');
  if(renderingPanel)move(renderingPanel,'authoring-render-slot');
  let workbenchRenderingHidden=renderingPanel?.hidden;
  move(byId('local-liquid-performance'), 'authoring-type-slot');
  move(byId('composition-label').closest('.authoring-controls'), 'authoring-composition-slot');
  move(byId('scene-add-menu').closest('nav'), 'authoring-add-slot');
  move(byId('navigation-input-mode').closest('label'), 'authoring-navigation-slot');
  move(byId('viewport-shading'), 'authoring-shading-slot');
  // Child slots precede their parent slot so restoring is independent of order.
  let exportButton = null;
  for (const button of document.querySelectorAll('#transform-bar > button')) {
    const action = button.getAttribute('onclick') || '';
    if (/exportGLB/.test(action)) exportButton = button;
    else if (/saveScene|scene-file-input|openSavedScene/.test(action)) move(button, 'authoring-document-actions');
    else if (/setGizmoMode/.test(action)) move(button, 'authoring-gizmo-slot');
    // Grounding sits with the transform it changes, visible without opening Object tools.
    else if (/snapToGround|undoLeveling/.test(action)) move(button, 'authoring-transform-slot');
  }
  if (exportButton) move(exportButton, 'authoring-document-actions');
  move(byId('composition-capture'), 'authoring-document-actions');
  move(byId('transform-bar'), 'authoring-object-tools');
  const inspectorEntries = entries.filter(entry => inspector.contains(entry.destination));
  const workspaceSlots = createControlSlots(document, entries.filter(entry => !inspector.contains(entry.destination)));
  const inspectorSlots = createControlSlots(document, inspectorEntries);
  const sceneTreeSlots = createControlSlots(document, [{node: byId('scene-object-list').closest('.panel'), destination: byId('authoring-inspector-tree-slot')}]);
  let mode = null, inspectorActive = false, inspectorContext='object';
  // One inspector and one set of live property controls serve both modes.
  function setInspectorActive(active) {
    if (inspectorActive === active) return;
    if (active) {
      if(renderingPanel)workbenchRenderingHidden=renderingPanel.hidden;
      inspectorSlots.setActive(true); if(renderingPanel)renderingPanel.hidden=false;
    } else {
      inspectorSlots.setActive(false); if(renderingPanel)renderingPanel.hidden=workbenchRenderingHidden;
    }
    inspectorActive = active;
  }
  function setWorkbenchInspector(active) {
    if (mode !== 'workbench') return;
    document.activeElement?.blur?.();
    setInspectorActive(active); sceneTreeSlots.setActive(active);
    if (active && byId('transform-inspector').hidden) setContext('scene');
    byId('authoring-inspector-scene-tree').hidden=!active;
    document.body.classList.toggle('has-workbench-inspector',active);
  }
  function setContext(context) {
    if(context==='camera')context='scene'; // Existing camera-panel callers open scene-owned shot settings.
    if(!['object','scene','camera'].includes(context))throw Error('Unknown properties context');
    inspectorContext=context;
    const object = context === 'object';
    byId('authoring-object-properties').hidden = !object;
    byId('authoring-scene-properties').hidden = context!=='scene';
    byId('authoring-camera-properties').hidden = context!=='scene';
    inspector.querySelectorAll('[data-inspector-context]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.inspectorContext === context)));
    document.dispatchEvent(new document.defaultView.CustomEvent('kaminos-inspector-context-change',{detail:{context}}));
  }
  function setMode(next) {
    if (!['authoring', 'workbench'].includes(next)) throw new Error('Unknown workspace');
    if (mode === next) return true;
    if (beforeSwitch(next) === false) return false;
    // Blurring commits a normal field edit through its existing handler.
    document.activeElement?.blur?.();
    if (next === 'authoring') {
      workspaceSlots.setActive(true);setInspectorActive(true);
    } else {
      workspaceSlots.setActive(false);setInspectorActive(false);
    }
    mode = next;
    document.body.dataset.workspace = mode;
    document.dispatchEvent(new document.defaultView.CustomEvent('kaminos-workspace-change',{detail:{mode}}));
    header.querySelectorAll('[data-workspace-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === mode)));
    afterSwitch(mode);
    return true;
  }
  header.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.workspaceMode)));
  header.querySelectorAll('[data-workbench-tab]').forEach(button => button.addEventListener('click', () => { if(mode==='authoring'&&document.defaultView.kaminosAssets)document.defaultView.kaminosAssets.open(button.dataset.workbenchTab==='generate'?'generate':'browse');else if(setMode('workbench'))openWorkbenchTab(button.dataset.workbenchTab); }));
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
    byId('authoring-object-tools').hidden=!!source.dataset.selectedFieldId||Number(source.dataset.selectionCount)>1||!!source.dataset.selectedGroupId;
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
  return { setMode, setContext, setWorkbenchInspector, state: () => ({ mode, context: inspectorContext }) };
}
