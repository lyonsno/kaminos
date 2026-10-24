// Browse tab: one compact header row (collection chips, search, count, refresh), small
// square tiles with readable names, model badges and an "In scene" mark, and
// double-click to act. Modal's drawer controls are reused, not rebuilt; their ids and
// handlers stay as they are.

const MODEL_BADGES=[['SF3D','SF3D'],['TRELLIS','TRELLIS'],['Trellis','TRELLIS'],['Pixal','Pixal'],['Flux','Flux']];
// A readable title from an asset label: generated Klein images and the meshes made from
// them carry the prompt as a slug with a seed; the model becomes a badge.
export function friendlyAssetTitle(label){
  let text=String(label||'').trim().replace(/\.(glb|png|jpe?g|webp)$/i,'');
  let badge=null;
  const tail=text.match(/^(.*) · ([^·]+)$/);
  if(tail){const hit=MODEL_BADGES.find(([word])=>tail[2].trim()===word);if(hit){badge=hit[1];text=tail[1].replace(/\.(glb|png|jpe?g|webp)$/i,'');}}
  const klein=text.match(/^klein-(.*?)(?:-s\d+)?$/i);
  if(klein){text=klein[1].replace(/^(a|an|the)-/i,'');badge??='Klein';}
  if(!/\s/.test(text)&&/[-_]/.test(text))text=text.replace(/[-_]+/g,' ');
  text=text.trim();
  if(!text)return {title:'Untitled',badge};
  return {title:text.charAt(0).toUpperCase()+text.slice(1),badge};
}

// Camera distance that fits an object's box in a square-ish preview: whichever of the
// vertical or horizontal extent needs more room, plus the half depth toward the camera.
export function thumbnailDistance({size,fovDeg=35,aspect=1,margin=1.08}){
  const tanV=Math.tan(fovDeg*Math.PI/360),across=Math.max(size[0],size[2]);
  return margin*Math.max(size[1]/2/tanV,across/2/(tanV*aspect))+across/2;
}

const LABELS={'generated-meshes':'Saved meshes','image-inbox':'Source images',greenroom:'Generator outputs','agent-work':'Agent work',pixal3d:'Pixal',trellis2mlx:'TRELLIS'};

export function installBrowseLayout({document,controller,inScene=()=>new Set(),open=()=>{},openMasks=null}){
  const byId=id=>document.getElementById(id);
  const browse=byId('asset-browse');if(!browse)throw Error('Browse panel is missing');
  const header=document.createElement('div');header.id='asset-browse-header';
  const chips=document.createElement('div');chips.id='asset-collections';chips.setAttribute('role','tablist');
  const controls=browse.querySelector('.asset-folder-controls');
  header.append(chips,byId('asset-filter'),byId('asset-path'),byId('asset-refresh'));
  browse.prepend(header);
  if(controls)controls.hidden=true;
  // Masks on the selected image (SAM); a saved cutout comes back selected.
  const masks=document.createElement('button');masks.type='button';masks.id='asset-open-masks';masks.textContent='Masks…';masks.hidden=true;
  masks.onclick=()=>{const selected=controller.read().selected;if(selected?.kind==='image'&&selected.visibility?.status!=='withheld')openMasks?.(selected);};
  byId('asset-use-image')?.before(masks);
  let chipKey=null;
  // Double-click: a mesh goes into the scene, an image goes to Generate.
  byId('asset-entries').addEventListener('dblclick',event=>{
    const button=event.target.closest('.asset-entry');if(!button)return;
    const selected=controller.read().selected;if(!selected||selected.visibility?.status==='withheld')return;
    if(selected.kind==='mesh')controller.add().catch(()=>{});
    else if(selected.kind==='image')open('generate');
  });
  function render(){
    const state=controller.read();
    const key=state.roots.map(r=>r.id).join('|')+'#'+state.root;
    if(key!==chipKey){
      chipKey=key;
      chips.replaceChildren(...state.roots.map(root=>{
        const chip=document.createElement('button');chip.type='button';chip.className='asset-collection';chip.setAttribute('role','tab');
        chip.textContent=LABELS[root.id]||root.id;chip.setAttribute('aria-selected',String(root.id===state.root));
        chip.onclick=()=>controller.browse(root.id).catch?.(()=>{});return chip;
      }));
    }
    masks.hidden=!openMasks||state.selected?.kind!=='image'||state.selected.visibility?.status==='withheld';
    const present=inScene(),sourceByPath=new Map(state.entries.flatMap(e=>[[e.path,e.source],[e.source,e.source]]));
    for(const button of byId('asset-entries').querySelectorAll('.asset-entry')){
      const span=button.querySelector(':scope > span');if(!span)continue;
      const full=button.dataset.fullTitle||span.textContent.replace(/^[◇▸] /,'');
      if(!button.dataset.fullTitle){
        button.dataset.fullTitle=full;
        const {title,badge}=friendlyAssetTitle(full);
        span.textContent=title;button.title=full;
        const small=button.querySelector(':scope > small');
        if(small&&badge)small.textContent=`${small.textContent.split(' · ')[0]} · ${badge}`;
      }
      const source=sourceByPath.get(button.dataset.assetPath);
      button.dataset.inScene=String(!!source&&present.has(source));
    }
  }
  render();
  return {render};
}
