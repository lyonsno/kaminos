// Generate tab as three steps across the drawer: 1 Image (text -> image), 2 Mesh (the
// image that will be used, model choice, Generate mesh), 3 Results (meshes to Add).
// Existing controls are moved, not rebuilt, so their ids and handlers stay as they are.
import {installGenerationFlame} from './authoring-generation-flame.mjs';
import {installImageZoom} from './authoring-image-zoom.mjs';
import {assetSource,assetWithheld} from './authoring-assets.mjs';

export function generationImageView({selected,preparedSource=null,showSegmented=true,preview=null}){
  if(preview)return {source:null,preview,label:preview.kind==='partial'?`Partial preview · step ${preview.step} of ${preview.steps}`:'Generated image · not yet saved'};
  if(selected?.kind!=='image'||assetWithheld(selected))return {source:null,preview:null,label:'No image selected'};
  const original=selected.source||assetSource(selected.root,selected.path);
  const source=showSegmented&&preparedSource?preparedSource:original;
  return {source,preview:null,label:source===original?'Original image':'Segmented image'};
}

export function generationComparisonView({selected,comparison,preparedSource=null,showSegmented=true,preview=null}){
 const original=selected?.source||(selected?.root&&selected?.path?assetSource(selected.root,selected.path):null);
 const prepared=showSegmented&&!!comparison?.preparedSource&&!!preparedSource&&preparedSource!==original;
 return {left:comparison&&!assetWithheld(comparison)?(prepared?comparison.preparedSource:comparison.source):null,
  right:generationImageView({selected,preparedSource,showSegmented:prepared,preview}),label:prepared?'Segmented images':'Original images'};
}

export function installGenerateLayout({document,trellisSettings=()=>null,queueLine=()=>'',openMasks=null,selected=()=>null,imageState=()=>null,createFlame=null,history=null,kiln=null}){

  const pane=document.getElementById('asset-generate');if(!pane)throw Error('Generate panel is missing');
  const byId=id=>document.getElementById(id);
  const column=(id,step,title)=>{const c=document.createElement('section');c.id=id;c.className='asset-step';c.innerHTML=`<h3><span>${step}</span>${title}</h3>`;return c;};
  const image=column('asset-step-image','1','Image'),mesh=column('asset-step-mesh','2','Mesh'),results=column('asset-step-results','3','Results');
  const paragraphs=[...pane.querySelectorAll(':scope > p')];
  const heading=paragraphs.find(p=>p.textContent.startsWith('Image → textured mesh')),help=pane.querySelector(':scope > p.asset-help');
  const text=byId('asset-text-image');
  if(text){text.querySelector(':scope > p')?.remove();image.append(...text.childNodes);text.remove();}
  const imageHelp=document.createElement('p');imageHelp.className='asset-help';imageHelp.textContent='Or pick an image in Browse, or open one from disk.';image.append(imageHelp);
  let showSegmented=true,expanded=false,comparing=false,painted=null,viewIdentity=null;
  const preference='kaminos.generate-image-view.v1';
  try{showSegmented=JSON.parse(document.defaultView.localStorage.getItem(preference))?.showSegmented!==false;}catch{/* unavailable storage keeps the page-local choice */}
  const preview=document.createElement('img');preview.id='asset-step-source';preview.alt='Generated or selected image';preview.hidden=true;
  const canvas=document.createElement('canvas');canvas.id='asset-step-preview';canvas.hidden=true;canvas.setAttribute('role','img');
  const frame=document.createElement('div');frame.className='asset-image-view asset-compare-current';frame.append(preview,canvas);
  const kilnPanel=document.createElement('section');kilnPanel.className='generation-kiln';
  const kilnView=document.createElement('div');kilnView.className='generation-kiln-view';
  const kilnTools=document.createElement('div');kilnTools.className='generation-kiln-tools';
  const kilnLabel=document.createElement('span');kilnLabel.textContent='Inference Kiln';
  const kilnChoose=document.createElement('button');kilnChoose.type='button';kilnChoose.textContent='Choose kiln…';
  const kilnDesign=document.createElement('a');kilnDesign.textContent='Design in Workbench';kilnDesign.target='_blank';kilnDesign.rel='noopener';
  const kilnStatus=document.createElement('p');kilnStatus.className='asset-help';kilnStatus.setAttribute('role','status');
  const syncKiln=()=>{kilnLabel.textContent=kiln?.read()?.document?.label??'Inference Kiln';kilnDesign.href=kiln?.designURL?.()??'./inference-kiln-study.html?material=1';};
  kilnTools.append(kilnLabel,kilnChoose,kilnDesign);kilnPanel.append(kilnTools,kilnView,kilnStatus);
  const imageOptions=image.querySelector('.asset-text-image-actions'),imageActions=document.createElement('div');imageActions.className='asset-text-image-actions';
  // Keep Generate/Stop and output size above the preview as it grows. All
  // existing controls retain their identities and controller handlers.
  for(const id of ['asset-text-run','asset-text-decode','asset-text-stop','asset-text-retry']){const control=image.querySelector('#'+id);if(control)imageActions.append(control);}
  const imageSize=image.querySelector('#asset-image-size')?.closest('label');if(imageSize)imageActions.append(imageSize);
  if(imageOptions)imageOptions.before(imageActions,kilnPanel);else image.append(imageActions,kilnPanel);
  const ceremony=createFlame?installGenerationFlame({document,slot:kilnView,createRenderer:createFlame}):null;
  kilnChoose.onclick=async()=>{try{if(await kiln?.choose()){syncKiln();await ceremony?.refresh();kilnStatus.textContent='';}}catch(error){kilnStatus.textContent=error.message;}};
  kiln?.load().then(syncKiln).catch(error=>{kilnStatus.textContent=error.message;});syncKiln();
  const observer=ceremony&&new document.defaultView.IntersectionObserver(entries=>{ceremony.setVisible(entries.some(entry=>entry.isIntersecting));});observer?.observe(kilnView);
  image.querySelector('#asset-prompt')?.addEventListener('change',()=>{if(!ceremony?.read().running)ceremony?.refresh();});
  document.defaultView.addEventListener('focus',async()=>{try{const before=kiln?.read(),next=await kiln?.load();if(JSON.stringify([before?.selection,before?.document])!==JSON.stringify([next?.selection,next?.document]))await ceremony?.refresh();syncKiln();}catch(error){kilnStatus.textContent=error.message;}});
  const pair=document.createElement('div');pair.id='asset-image-comparison';pair.className='asset-image-pair';
  const inputFrame=document.createElement('div');inputFrame.className='asset-image-view asset-compare-input';inputFrame.hidden=true;const inputPreview=document.createElement('img');inputPreview.id='asset-compare-source';inputPreview.alt='Comparison input';inputFrame.append(inputPreview);
  const blink=document.createElement('img');blink.id='asset-compare-blink';blink.hidden=true;blink.alt='Comparison input';frame.append(blink);pair.append(inputFrame,frame);
  const compareTools=document.createElement('div');compareTools.className='asset-compare-tools';compareTools.hidden=true;
  const choose=document.createElement('select');choose.id='asset-compare-choice';choose.setAttribute('aria-label','Compare image with');
  const hold=document.createElement('button');hold.type='button';hold.id='asset-compare-hold';hold.textContent='Hold to show input';hold.title='Hold here to show the comparison input over the result';
  const setBlink=value=>{blink.hidden=!value;};hold.addEventListener('pointerdown',e=>{hold.setPointerCapture(e.pointerId);setBlink(true);});for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])hold.addEventListener(name,()=>setBlink(false));hold.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();setBlink(true);}});hold.addEventListener('keyup',e=>{if(e.code==='Space')setBlink(false);});
  choose.onchange=()=>{history?.compare(choose.value);render();};compareTools.append(choose,hold);

  const tools=document.createElement('div');tools.className='asset-image-view-tools';
  const toggleLabel=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.id='asset-show-segmented';toggle.checked=showSegmented;
  toggleLabel.append(toggle,document.createTextNode('Show segmented'));toggleLabel.title='Changes the displayed image; mesh generation still uses its prepared input.';
  const expand=document.createElement('button');expand.type='button';expand.id='asset-image-expand';expand.textContent='Expand image';expand.setAttribute('aria-expanded','false');expand.setAttribute('aria-controls','asset-step-mesh');
  const caption=document.createElement('span');caption.id='asset-image-view-label';
  const fit=document.createElement('button');fit.type='button';fit.id='asset-image-fit';fit.hidden=true;
  const zoom=installImageZoom({frame,targets:[preview,canvas,inputPreview,blink],resetButton:fit,peers:[inputFrame]});
  tools.append(toggleLabel,fit,expand);mesh.append(tools,compareTools,pair,caption);
  const timing=image.querySelector('#asset-image-timing');if(timing)mesh.insertBefore(timing,pair);
  const sourceName=document.createElement('div');sourceName.id='asset-step-source-name';
  const settings=document.createElement('div');settings.id='asset-mesh-settings';
  const queue=document.createElement('div');queue.id='asset-queue-line';queue.setAttribute('role','status');
  // The input and action share a row so neither is buried by model help text.
  const actions=document.createElement('div');actions.className='asset-step-actions';
  actions.append(...[byId('asset-run'),byId('asset-prepare'),byId('asset-recover')].filter(Boolean));
  const masks=document.createElement('button');masks.type='button';masks.id='asset-step-masks';masks.textContent='Masks…';masks.title='Cut out part of this image with SAM';
  masks.onclick=()=>{const image=selected();if(image?.kind==='image'&&image.visibility?.status!=='withheld')openMasks?.(image);};actions.append(masks);
  const controls=document.createElement('div');controls.className='asset-mesh-controls';
  controls.append(...[byId('asset-mesh-model-row'),actions,byId('asset-express-row')].filter(Boolean));
  const input=document.createElement('div');input.className='asset-mesh-input';input.append(controls);
  mesh.append(input,sourceName,settings,queue,...[byId('asset-preparation-status')].filter(Boolean));
  heading?.remove();help?.remove();
  const resultList=byId('asset-results');const empty=document.createElement('p');empty.className='asset-help';empty.id='asset-results-empty';empty.textContent='Generated meshes appear here. Add puts one in the scene.';
  results.append(empty,resultList);
  pane.replaceChildren(image,mesh,results);
  toggle.onchange=()=>{showSegmented=toggle.checked;try{document.defaultView.localStorage.setItem(preference,JSON.stringify({showSegmented}));}catch{/* the choice still persists between this page's generations */}render();};
  expand.onclick=()=>{expanded=!expanded;pane.dataset.imageExpanded=String(expanded);expand.textContent=expanded?'Collapse image':'Expand image';expand.setAttribute('aria-expanded',String(expanded));};
  function render(){
    // The drawer's detail column shows the selected image in Browse; in Generate the
    // Mesh step shows it, at the stage generation will actually use.
    const source=byId('asset-image'),state=imageState();ceremony?.render(state);
    const comparison=history?.comparison(),journal=history?.read();
    const paired=generationComparisonView({selected:selected(),comparison,preparedSource:source&&!source.hidden?source.getAttribute('src'):null,showSegmented,preview:state?.preview});
    pair.dataset.comparing=String(comparing);inputFrame.hidden=!comparing;compareTools.hidden=!comparing;
    if(comparing){
     const candidates=journal?.entries.filter(e=>e.visibility?.status!=='withheld')||[];
     if(comparison&&!candidates.some(e=>e.source===comparison.source))candidates.unshift(comparison);
     const key=JSON.stringify(candidates.map(e=>[e.source,e.name]));if(choose.dataset.entries!==key){choose.dataset.entries=key;choose.replaceChildren(...candidates.map((e,i)=>{const option=document.createElement('option');option.value=e.source;option.textContent=`${i+1} · ${e.name||'Image'}`;return option;}));}
     choose.value=comparison?.source||'';hold.disabled=!comparison;
     const input=paired.left;
     if(input){if(inputPreview.getAttribute('src')!==input){inputPreview.src=input;blink.src=input;}inputPreview.hidden=false;inputPreview.alt=`Comparison · ${comparison.name||'Input'}`;}else{inputPreview.removeAttribute('src');blink.removeAttribute('src');inputPreview.hidden=true;}
    }else blink.hidden=true;
    const view=comparing?paired.right:generationImageView({selected:selected(),preparedSource:source&&!source.hidden?source.getAttribute('src'):null,showSegmented,preview:state?.preview});
    const identity=view.preview?.runId||selected()?.source||selected()?.path||null;
    if(identity!==viewIdentity){zoom.reset();viewIdentity=identity;}
    const showing=!!(view.source||view.preview);frame.hidden=!showing;preview.hidden=!view.source;canvas.hidden=!view.preview;
    if(view.source&&preview.getAttribute('src')!==view.source)preview.src=view.source;
    if(!view.source)preview.removeAttribute('src');preview.alt=view.label;caption.textContent=comparing?paired.label:view.label;caption.hidden=!showing;
    if(view.preview){
      const p=view.preview,key=`${p.runId}:${p.kind}:${p.step}`;
      if(painted!==key){canvas.width=p.width;canvas.height=p.height;canvas.getContext('2d').putImageData(new document.defaultView.ImageData(p.rgba,p.width,p.height),0,0);painted=key;}
      canvas.setAttribute('aria-label',view.label);
    }else painted=null;
    expand.disabled=!showing;
    sourceName.textContent=view.preview?'':selected()?.visibility?.status==='withheld'?'Hostile to eyesight. Awaiting further review.':showing?byId('asset-name')?.textContent||'':'No image yet. Generate one in step 1 or pick one in Browse.';
    preview.title=showing?sourceName.textContent:'';
    const model=byId('asset-mesh-model')?.value,t=trellisSettings();
    settings.textContent=model==='trellis'?(t?`${t} · set on the server for now`:'Settings are set on the server for now'):model==='trellis-page'?'Settings come from the mounted checkpoint package · f16 decoders · 200k faces · Stop ends it at the next GPU step.':'Stable Fast 3D runs on this page beside the kiln, in about a minute.';
    masks.hidden=!openMasks||selected()?.kind!=='image'||selected()?.visibility?.status==='withheld';
    const line=queueLine();queue.textContent=line;queue.hidden=!line;
    empty.hidden=resultList.children.length>0;
  }
  render();
  return {render,ceremony,comparing:()=>comparing,compare(value=true){comparing=!!value;if(comparing){expanded=true;pane.dataset.imageExpanded='true';expand.textContent='Collapse image';expand.setAttribute('aria-expanded','true');if(!history?.comparison()&&history?.reference())history.compare(history.reference().source);}render();}};
}
