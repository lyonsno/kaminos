// Generate tab as three steps across the drawer: 1 Image (text -> image), 2 Mesh (the
// image that will be used, model choice, Generate mesh), 3 Results (meshes to Add).
// Existing controls are moved, not rebuilt, so their ids and handlers stay as they are.
export function installGenerateLayout({document,trellisSettings=()=>null,queueLine=()=>''}){
  const pane=document.getElementById('asset-generate');if(!pane)throw Error('Generate panel is missing');
  const byId=id=>document.getElementById(id);
  const column=(id,step,title)=>{const c=document.createElement('section');c.id=id;c.className='asset-step';c.innerHTML=`<h3><span>${step}</span>${title}</h3>`;return c;};
  const image=column('asset-step-image','1','Image'),mesh=column('asset-step-mesh','2','Mesh'),results=column('asset-step-results','3','Results');
  const paragraphs=[...pane.querySelectorAll(':scope > p')];
  const heading=paragraphs.find(p=>p.textContent.startsWith('Image → textured mesh')),help=pane.querySelector(':scope > p.asset-help');
  const text=byId('asset-text-image');
  if(text){text.querySelector(':scope > p')?.remove();image.append(...text.childNodes);text.remove();}
  const imageHelp=document.createElement('p');imageHelp.className='asset-help';imageHelp.textContent='Or pick an image in Browse, or open one from disk.';image.append(imageHelp);
  const preview=document.createElement('img');preview.id='asset-step-source';preview.alt='Image the mesh will be made from';preview.hidden=true;
  const sourceName=document.createElement('div');sourceName.id='asset-step-source-name';
  const settings=document.createElement('div');settings.id='asset-mesh-settings';
  const queue=document.createElement('div');queue.id='asset-queue-line';queue.setAttribute('role','status');
  // Action first: the model and its button stay in view; the preview takes what is left.
  const actions=document.createElement('div');actions.className='asset-step-actions';
  actions.append(...[byId('asset-prepare'),byId('asset-run'),byId('asset-recover')].filter(Boolean));
  mesh.append(...[byId('asset-mesh-model-row'),byId('asset-express-row'),settings,actions,queue,preview,sourceName,byId('asset-preparation-status')].filter(Boolean));
  heading?.remove();help?.remove();
  const resultList=byId('asset-results');const empty=document.createElement('p');empty.className='asset-help';empty.id='asset-results-empty';empty.textContent='Generated meshes appear here. Add puts one in the scene.';
  results.append(empty,resultList);
  pane.replaceChildren(image,mesh,results);
  function render(){
    // The drawer's detail column shows the selected image in Browse; in Generate the
    // Mesh step shows it, at the stage generation will actually use.
    const source=byId('asset-image');const showing=source&&!source.hidden&&source.getAttribute('src');
    preview.hidden=!showing;if(showing&&preview.getAttribute('src')!==source.getAttribute('src'))preview.src=source.getAttribute('src');
    sourceName.textContent=showing?byId('asset-name')?.textContent||'':'No image yet. Generate one in step 1 or pick one in Browse.';
    const model=byId('asset-mesh-model')?.value,t=trellisSettings();
    settings.textContent=model==='trellis'?(t?`${t} · set on the server for now`:'Settings are set on the server for now'):'Stable Fast 3D runs on this page beside the kiln, in about a minute.';
    const line=queueLine();queue.textContent=line;queue.hidden=!line;
    empty.hidden=resultList.children.length>0;
  }
  render();
  return {render};
}
