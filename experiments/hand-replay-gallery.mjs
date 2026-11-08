export const isStillGallery=catalog=>Boolean(catalog.sequences?.length)&&catalog.sequences.every(sequence=>sequence.frames===1);

export function mountStillGallery({root,document,read,invoke,catalog,title,description,installNumberDrag}){
 const section=document.createElement('section');section.dataset.handGallery='navigation';
 section.style.cssText='display:grid;gap:10px;margin:0 0 18px;padding:14px;border:1px solid #586a7d;border-radius:10px;background:#17232f;color:#edf4fb';
 const heading=document.createElement('h2');heading.textContent=title??'Hand comparison';heading.style.cssText='font:600 19px system-ui;margin:0';
 const intro=document.createElement('p');intro.textContent=description??'Browse the saved photographs. Every hand view uses the same source photograph.';intro.style.cssText='font:13px/1.5 system-ui;margin:0;color:#c4d1df';
 const counter=document.createElement('div');counter.setAttribute('aria-label','Example position');counter.setAttribute('aria-live','polite');counter.style.cssText='font:600 17px system-ui;font-variant-numeric:tabular-nums';
 const buttons=document.createElement('div');buttons.style.cssText='display:flex;gap:8px';
 const move=value=>Promise.resolve(invoke('selectExample',value)).catch(()=>sync());
 const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',label+' example');b.style.cssText='flex:1;padding:10px 8px;border:1px solid #8199ae;border-radius:7px;background:#304b61;color:#fff;font:600 14px system-ui;cursor:pointer';b.onclick=action;buttons.append(b);return b;};
 const previous=button('Previous',()=>move(read().gallery.index-1));const next=button('Next',()=>move(read().gallery.index+1));
 const play=button('Play',()=>Promise.resolve(invoke('toggle')).catch(()=>sync()));play.setAttribute('aria-label','Play sequence');
 const cadence=document.createElement('label');cadence.textContent='Seconds per example ';const interval=document.createElement('input');interval.type='number';interval.step='.1';interval.value=String(read().playback.exampleIntervalMs/1000);interval.setAttribute('aria-label','Seconds per example');interval.style.cssText='width:75px';interval.oninput=()=>Promise.resolve(invoke('setExampleInterval',Number(interval.value)*1000)).catch(()=>sync());cadence.append(interval);installNumberDrag?.({input:interval,step:.1});
 const select=document.createElement('select');select.setAttribute('aria-label','Example');select.style.cssText='width:100%;min-width:0;font:13px system-ui;padding:9px';
 catalog.sequences.forEach((sequence,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${index+1} · ${sequence.label??'Photograph'}`;select.append(option);});
 select.onchange=()=>move(Number(select.value));
 const hint=document.createElement('small');hint.textContent='← / → to browse · Play advances through the saved examples';hint.style.cssText='font:12px/1.4 system-ui;color:#b5c6d8';
 section.append(heading,intro,counter,buttons,select,cadence,hint);root.append(section);
 const sync=()=>{const state=read(),gallery=state.gallery;if(!gallery)return;counter.textContent=state.error?String(state.error):state.loading?'Loading photograph…':`Example ${gallery.index+1} of ${gallery.total}`;select.value=String(gallery.index);select.disabled=state.loading;previous.disabled=state.loading||gallery.index===0;next.disabled=state.loading||gallery.index===gallery.total-1;play.textContent=state.playing?'Pause':'Play';play.setAttribute('aria-label',state.playing?'Pause sequence':'Play sequence');play.disabled=!state.playing&&(state.loading||!!state.error);if(document.activeElement!==interval)interval.value=String(state.playback.exampleIntervalMs/1000);};
 const keydown=event=>{if(event.defaultPrevented||event.metaKey||event.ctrlKey||event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;const target=event.target;if(target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target?.tagName))return;const state=read();if(state.loading)return;const index=state.gallery.index+(event.key==='ArrowRight'?1:-1);if(index<0||index>=state.gallery.total)return;event.preventDefault();return move(index);};
 document.addEventListener?.('keydown',keydown);sync();
 return {sync,dispose(){document.removeEventListener?.('keydown',keydown);section.remove?.();}};
}
