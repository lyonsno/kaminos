// Visible, keyboard-native choices for an experiment's small option set.
export function createChoiceButtons(document,{label,entries,onChange}){
 const root=document.createElement('div');root.setAttribute('role','group');root.setAttribute('aria-label',label);root.style.display='flex';root.style.flexWrap='wrap';root.style.gap='5px';root.style.margin='6px 0 12px';
 let selected='',disabled=false;const buttons=[];
 for(const [value,title,unavailable=false] of entries){const button=document.createElement('button');button.type='button';button.textContent=title;button.dataset.value=value;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{if(!disabled&&!unavailable)onChange(value);});root.append(button);buttons.push({button,value,unavailable});}
 const sync=()=>{for(const {button,value,unavailable}of buttons){const active=value===selected;button.setAttribute('aria-pressed',String(active));button.disabled=disabled||unavailable;button.style.background=active?'#24585d':'';button.style.borderColor=active?'#69d4cc':'';button.style.color=active?'#efffff':'';}};
 Object.defineProperties(root,{value:{get:()=>selected,set:value=>{selected=value;sync();}},disabled:{get:()=>disabled,set:value=>{disabled=!!value;sync();}}});return root;
}
