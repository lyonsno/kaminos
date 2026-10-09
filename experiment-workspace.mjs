import {createControlSlots} from './authoring-workspace.mjs';

// Layout custody only: all scene, controls, clock and rendering stay with their
// existing owners. Release these slots before another workspace acquires them.
export function installExperimentWorkspace({document, title, subtitle, instruments, instrumentTitle=title, instrumentHelp='',
  setup, sceneNodes=[], selectionNodes=[], detailNodes=[], runNodes=[], viewerNodes=[],
  navigation, tools, openTool, openSetup, frame}) {
  const make=(tag,id,html)=>{const node=document.createElement(tag);node.id=id;node.innerHTML=html;return node;};
  const left=make('aside','experiment-setup',`<div class="experiment-panel-heading"><h2></h2><p></p></div>
    <div class="experiment-setup-body"><section id="experiment-setup-slot"></section>
    <h3>Scene</h3><div id="experiment-scene-slot"></div>
    <details id="experiment-selection"><summary>Selection properties</summary><div id="experiment-selection-slot"></div></details>
    <details id="experiment-viewer" open><summary>Environment & lighting</summary><div id="experiment-viewer-slot"></div></details></div>`);
  left.querySelector('h2').textContent=title;left.querySelector('p').textContent=subtitle;
  const right=make('aside','experiment-instruments',`<div class="experiment-panel-heading"><h2></h2><p></p></div>
    <div class="experiment-instruments-body"><div id="experiment-instrument-slot"></div>
    <details id="experiment-details"><summary>Runtime details</summary><div id="experiment-detail-slot"></div></details></div>`);
  right.querySelector('h2').textContent=instrumentTitle;right.querySelector('p').textContent=instrumentHelp;
  const toolbar=make('nav','experiment-toolbar',`<details id="experiment-browser"><summary>Workbenches</summary><div><input type="search" aria-label="Find a workbench" placeholder="Find a workbench…"><div class="experiment-browser-list"></div></div></details>
    <strong></strong><span class="experiment-toolbar-spacer"></span>
    <button type="button" id="experiment-open-setup">Open these settings</button>
    <button type="button" id="experiment-frame">Frame</button><div id="experiment-navigation-slot"></div>`);
  toolbar.setAttribute('aria-label','Experiment tools'); toolbar.querySelector('strong').textContent=title;
  const run=make('div','experiment-run-strip',`<span id="experiment-source">Synthetic fluid · loading</span><div id="experiment-run-controls"></div><span id="experiment-clock"></span>`);
  run.setAttribute('aria-label','Simulation run');
  document.body.append(left,right);document.getElementById('viewport').append(toolbar,run);
  const byId=id=>document.getElementById(id);
  const entries=[];const mount=(nodes,id)=>{for(const node of nodes.filter(Boolean))entries.push({node,destination:byId(id)});};
  mount([setup],'experiment-setup-slot');mount(sceneNodes,'experiment-scene-slot');mount(selectionNodes,'experiment-selection-slot');
  mount([instruments],'experiment-instrument-slot');mount(detailNodes,'experiment-detail-slot');mount(runNodes,'experiment-run-controls');
  mount(viewerNodes,'experiment-viewer-slot');mount([navigation],'experiment-navigation-slot');
  const slots=createControlSlots(document,entries);
  for(const {label,id} of tools){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.workbench=id;
    button.onclick=()=>{byId('experiment-browser').open=false;openTool(id);};
    toolbar.querySelector('.experiment-browser-list').append(button);
  }
  toolbar.querySelector('input').addEventListener('input',event=>{
    const term=event.target.value.trim().toLowerCase();
    toolbar.querySelectorAll('[data-workbench]').forEach(button=>{button.hidden=!button.textContent.toLowerCase().includes(term);});
  });
  byId('experiment-frame').onclick=frame;
  byId('experiment-open-setup').onclick=openSetup;
  document.addEventListener('pointerdown',event=>{if(!byId('experiment-browser').contains(event.target))byId('experiment-browser').open=false;},true);
  let active=false;
  const text=(id,value)=>{const node=byId(id);if(node.textContent!==value)node.textContent=value;};
  const api={
    setActive(value){
      if(active===value)return;
      // Existing focus/blur handlers own commit semantics.
      document.activeElement?.blur?.();slots.setActive(value);active=value;
      document.body.classList.toggle('experiment-workspace',value);
      for(const node of [left,right,toolbar,run])node.hidden=!value;
      document.defaultView._kaminosDirty?.();
    },
    update({source,status,clock}){
      text('experiment-source',`${source} · ${status}`);text('experiment-clock',clock);
    },
    state:()=>({active,title}),
  };
  for(const node of [left,right,toolbar,run])node.hidden=true;
  return api;
}
