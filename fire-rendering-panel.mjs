const organized=new WeakSet();
// Keep the historical controls and their operations intact for old routes and
// diagnostic calls; only the hybrid consumer gets this shipping presentation.
export function organizeFireRenderingPanel(document) {
  const panel=document.getElementById('rendering-fire-controls');
  if(organized.has(panel))return;
  organized.add(panel);
  const heading=text=>{const node=document.createElement('h3');node.textContent=text;panel.append(node);};
  const moveRow=id=>panel.append(document.getElementById(id).closest('.slider-row, label'));
  heading('Fire illumination');
  moveRow('rendering-shared-gain');
  moveRow('rendering-surface-gain');
  moveRow('rendering-source-softness');
  moveRow('rendering-match-flame-camera');
  heading('Smoke lighting');
  panel.append(document.querySelector('label[for="rendering-angular-samples"]'),document.getElementById('rendering-angular-samples'));
  panel.append(document.getElementById('rendering-fire-shadows'));
  document.getElementById('rendering-light-study').hidden=true;
  panel.hidden=false;
}
