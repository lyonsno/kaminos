// Selection owns the row; naming is an explicit second gesture.
export function bindSceneHierarchyRows(list,{selectObject,selectGroup,renameObject,renameGroup}) {
  for(const row of list.querySelectorAll('[data-scene-object-id], [data-scene-group-id]')) {
    const group=!!row.dataset.sceneGroupId,id=row.dataset.sceneGroupId || row.dataset.sceneObjectId;
    const input=row.querySelector('.scene-name-input');
    input.readOnly=true;input.tabIndex=-1;
    let original=input.value,editing=false;
    function edit(){original=input.value;editing=true;input.readOnly=false;input.focus();input.select();}
    function end(cancel=false){if(!editing)return;editing=false;input.readOnly=true;
      if(cancel)input.value=original;
      else if(input.value!==original)(group?renameGroup:renameObject)(id,input.value);
      input.blur();
    }
    row.addEventListener('click',event=>{
      if(event.target.closest('button') || editing)return;
      if(event.detail===2){edit();return;}
      (group?selectGroup:selectObject)(id,{extend:!!event.shiftKey});
    });
    row.addEventListener('dblclick',event=>{if(!event.target.closest('button'))edit();});
    row.addEventListener('keydown',event=>{
      if(editing){if(event.key==='Escape'||event.key==='Enter'){event.preventDefault();event.stopPropagation();end(event.key==='Escape');}return;}
      if(event.target!==row)return;
      if(event.key==='F2'){event.preventDefault();edit();}
      if(event.key==='Enter'||event.key===' '){event.preventDefault();(group?selectGroup:selectObject)(id);}
    });
    input.addEventListener('blur',()=>end());
  }
}
