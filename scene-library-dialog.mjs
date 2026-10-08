export function createSceneLibraryDialog({document,list,refresh,importFile,onCancel=()=>{}}) {
  const dialog=document.createElement('dialog');
  dialog.id='scene-load-dialog';dialog.setAttribute('aria-labelledby','scene-load-title');
  dialog.innerHTML='<header><h2 id="scene-load-title">Load Scene</h2><button type="button" class="btn" data-scene-close aria-label="Close scene library">Close</button></header><div data-scene-list></div><footer><button type="button" class="btn" data-scene-refresh>Refresh</button><button type="button" class="btn" data-scene-import>Import scene file...</button></footer>';
  document.body.append(dialog);
  let marker=null;
  const restore=()=>{marker?.replaceWith(list);marker=null;};
  const close=()=>{onCancel();if(dialog.open){restore();dialog.close();}};
  const reload=async()=>{
    list.textContent='Loading scenes...';
    try{await refresh();}catch(error){list.textContent='Scene list failed: '+error.message;}
  };
  dialog.querySelector('[data-scene-close]').onclick=close;
  dialog.querySelector('[data-scene-refresh]').onclick=reload;
  dialog.querySelector('[data-scene-import]').onclick=()=>{close();importFile();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{if(!dialog.open)restore();});
  dialog.addEventListener('click',event=>{
    const r=dialog.getBoundingClientRect();
    if(event.target===dialog && (event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))close();
  });
  // Keep background scene shortcuts out of the native file-library dialog.
  document.defaultView.addEventListener('keydown',event=>{if(dialog.open)event.stopImmediatePropagation();},true);
  return {
    async open(){
      if(!dialog.open){
        marker=document.createComment('scene-library-home');list.before(marker);
        dialog.querySelector('[data-scene-list]').append(list);dialog.showModal();
      }
      await reload();
    },
    close,
  };
}
