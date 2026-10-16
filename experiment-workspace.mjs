import {createControlSlots} from './authoring-workspace.mjs';

// Layout custody only: all scene, controls, clock and rendering stay with their
// existing owners. Release these slots before another workspace acquires them.
export function installExperimentWorkspace({document, title, subtitle, instruments, instrumentTitle=title, instrumentHelp='',
  setup, inspector, investigation=null, detailNodes=[], runNodes=[],
  sceneActions, navigation, tools, openTool, frame, toolPanels=[], extraPanels=[],sceneOutline=null}) {
  const make=(tag,id,html)=>{const node=document.createElement(tag);node.id=id;node.innerHTML=html;return node;};
  const left=make('aside','experiment-instruments',`<div class="experiment-panel-heading"><h2></h2><p></p></div>
    <div class="experiment-instruments-body"><details id="experiment-browser"><summary>Tools</summary><div><input type="search" aria-label="Find a workbench" placeholder="Find a tool…"><div class="experiment-browser-list"></div></div></details>
    <div id="experiment-scene-slot" hidden></div><div id="experiment-owner-slot"></div><div id="experiment-tool-slot"></div><section id="experiment-setup-slot"></section><section id="experiment-investigation-slot" aria-label="Investigation" hidden></section><h3 id="experiment-tuning-title"></h3><p id="experiment-tuning-help"></p><div id="experiment-instrument-slot"></div>
    <details id="experiment-details"><summary>Runtime details</summary><div id="experiment-detail-slot"></div></details></div>`);
  left.querySelector('h2').textContent=title;left.querySelector('p').textContent=subtitle;
  const toolbar=make('nav','experiment-toolbar',`<strong></strong><div id="experiment-add-slot"></div><span class="experiment-toolbar-spacer"></span>
    <button type="button" id="experiment-frame">Frame</button><div id="experiment-navigation-slot"></div>`);
  toolbar.setAttribute('aria-label','Experiment tools'); toolbar.querySelector('strong').textContent=title;
  const run=make('div','experiment-run-strip',`<span id="experiment-source">Synthetic fluid · loading</span><div id="experiment-run-controls"></div><span id="experiment-clock"></span>`);
  run.setAttribute('aria-label','Simulation run');
  document.body.append(left);document.getElementById('viewport').append(toolbar,run);
  const byId=id=>document.getElementById(id);
  const entries=[];const mount=(nodes,id)=>{for(const node of nodes.filter(Boolean))entries.push({node,destination:byId(id)});};
  byId('experiment-tuning-title').textContent=instrumentTitle;byId('experiment-tuning-help').textContent=instrumentHelp;
  mount([setup],'experiment-setup-slot');
  mount([instruments],'experiment-instrument-slot');mount(detailNodes,'experiment-detail-slot');mount(runNodes,'experiment-run-controls');
  let instrumentSlots=createControlSlots(document,entries);
  let controlsMounted=!!instruments;
  entries.length=0;
  mount([navigation],'experiment-navigation-slot');mount([sceneActions],'experiment-add-slot');
  const slots=createControlSlots(document,entries);
  const toolSlots=createControlSlots(document,toolPanels.map(node=>({node,destination:byId("experiment-tool-slot")})));
  const extras=createControlSlots(document,extraPanels);
  let selectedTool="finger-fluid-bench";
  for(const {label,id} of tools){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.workbench=id;
    button.onclick=()=>{byId('experiment-browser').open=false;openTool(id);};
    left.querySelector('.experiment-browser-list').append(button);
  }
  left.querySelector('input').addEventListener('input',event=>{
    const term=event.target.value.trim().toLowerCase();
    left.querySelectorAll('[data-workbench]').forEach(button=>{button.hidden=!button.textContent.toLowerCase().includes(term);});
  });
  byId('experiment-frame').onclick=frame;
  document.addEventListener('pointerdown',event=>{if(!byId('experiment-browser').contains(event.target))byId('experiment-browser').open=false;},true);
  let active=false,ownerControlsActive=false;
  const text=(id,value)=>{const node=byId(id);if(node.textContent!==value)node.textContent=value;};
  const investigationSlot=byId('experiment-investigation-slot');
  let investigationTool='finger-fluid-bench';
  const setInvestigation=(node,{tool='finger-fluid-bench'}={})=>{
    // The investigation owner supplies one live component. Moving that node
    // preserves its handlers, drafts and session binding through layout changes.
    investigationSlot.replaceChildren(...(node ? [node] : []));
    investigationTool=tool;
    investigationSlot.hidden=!node||selectedTool!==investigationTool;
    document.defaultView._kaminosDirty?.();
  };
  setInvestigation(investigation);
  const api={
    setInvestigation,
    hasControls:()=>controlsMounted,
    setOwnerControlsActive(value){ownerControlsActive=Boolean(value);api.setTool(selectedTool);},
    setTool(id){
      selectedTool=id;
      const fluid=id==='finger-fluid-bench', label=tools.find(tool=>tool.id===id)?.label||id;
      left.querySelector('h2').textContent=label;left.querySelector('p').textContent=fluid?subtitle:'Workbench tools in the shared scene';
      toolbar.querySelector('strong').textContent=label;
      byId('experiment-browser').querySelector('summary').textContent='Tools · '+label;
      for(const name of ['setup-slot','tuning-title','tuning-help','instrument-slot','details'])byId('experiment-'+name).hidden=!(fluid&&controlsMounted);
      investigationSlot.hidden=selectedTool!==investigationTool||!investigationSlot.firstChild;
      byId('experiment-tool-slot').hidden=fluid&&controlsMounted;
      run.hidden=!active||!fluid;
      const objectScene=ownerControlsActive&&id==='assets';
      byId('experiment-owner-slot').hidden=objectScene;
      byId('experiment-scene-slot').hidden=!objectScene;
      if(objectScene){
        left.querySelector('h2').textContent='Scene';left.querySelector('p').textContent='Objects in this scene';
        toolbar.querySelector('strong').textContent='Scene';
        byId('experiment-tool-slot').hidden=true;
      }
      // Reuse the actual outliner node. Authoring owns its placement outside
      // Workbench; mode switching moves that same node through its existing slots.
      if(active&&sceneOutline){
        const destination=objectScene?byId('experiment-scene-slot'):byId('authoring-inspector-tree-slot');
        if(destination&&sceneOutline.parentNode!==destination)destination.append(sceneOutline);
      }
      left.querySelectorAll('[data-workbench]').forEach(button=>button.setAttribute('aria-current',String(button.dataset.workbench===id)));
    },
    setControls({instruments,setup,detailNodes=[],runNodes=[],instrumentTitle='',instrumentHelp=''}){
      // Entry-only presentation can acquire its actual live controls once.
      // The investigation node and its draft are outside these control slots.
      if(controlsMounted)return;
      const controls=[];
      const add=(nodes,id)=>{for(const node of nodes.filter(Boolean))controls.push({node,destination:byId(id)});};
      add([setup],'experiment-setup-slot');add([instruments],'experiment-instrument-slot');
      add(detailNodes,'experiment-detail-slot');add(runNodes,'experiment-run-controls');
      instrumentSlots=createControlSlots(document,controls);controlsMounted=true;
      byId('experiment-tuning-title').textContent=instrumentTitle;
      byId('experiment-tuning-help').textContent=instrumentHelp;
      instrumentSlots.setActive(active);
      api.setTool(selectedTool);
      document.defaultView._kaminosDirty?.();
    },
    setActive(value){
      if(active===value)return;
      // Existing focus/blur handlers own commit semantics.
      document.activeElement?.blur?.();slots.setActive(value);toolSlots.setActive(value);extras.setActive(value);instrumentSlots.setActive(value);inspector.setWorkbenchInspector(value);active=value;
      document.body.classList.toggle('experiment-workspace',value);
      for(const node of [left,toolbar,run])node.hidden=!value;
      api.setTool(selectedTool);
      document.defaultView._kaminosDirty?.();
    },
    update({source,status,clock}){
      text('experiment-source',`${source} · ${status}`);text('experiment-clock',clock);
    },
    state:()=>({active,title,tool:selectedTool}),
  };
  for(const node of [left,toolbar,run])node.hidden=true;
  return api;
}
