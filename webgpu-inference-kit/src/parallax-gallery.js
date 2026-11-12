const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderParallaxGallery({title,captures,reportUrl='report.json'}){
 const poses=[...new Map(captures.map(c=>[c.pose.id,c.pose])).values()],distances=[...new Set(poses.map(p=>p.distance))].sort((a,b)=>a-b),variants=[...new Set(captures.map(c=>c.variant))];
 if(!poses.length)throw Error('Retained captures required for a parallax gallery');
 const cell=p=>`<section data-pose="${esc(p.id)}"><h4>${p.group==='local'?`Δ az ${p.yawOffset}° · Δ el ${p.pitchOffset}°`:`Az ${p.azimuth}°`}</h4><div class="pair">${captures.filter(c=>c.pose.id===p.id).map(c=>`<figure data-variant="${esc(c.variant)}"><a href="${esc(c.artifact.file)}"><img src="${esc(c.artifact.file)}" loading="lazy"></a><figcaption>${esc(c.variant)}${c.state.effective!==c.variant?' · '+esc(c.state.effective):''}</figcaption></figure>`).join('')}</div></section>`;
 const overview=distance=>{
  const selected=poses.filter(p=>p.distance===distance&&p.group!=='local'),elevations=[...new Set(selected.map(p=>p.elevation))].sort((a,b)=>b-a);
  return elevations.map(e=>{const row=selected.filter(p=>p.elevation===e).sort((a,b)=>a.azimuth-b.azimuth);return `<h3>Elevation ${e}°</h3><div class="scroll"><div class="strip" style="--columns:${row.length}">${row.map(cell).join('')}</div></div>`;}).join('')||'<p>No overview captured at this magnification.</p>';
 };
 const local=distance=>{
  const selected=poses.filter(p=>p.distance===distance&&p.group==='local'),anchors=[...new Set(selected.map(p=>p.anchorId))];
  return anchors.map(id=>{const neighborhood=selected.filter(p=>p.anchorId===id),anchor=neighborhood[0],pitches=[...new Set(neighborhood.map(p=>p.pitchOffset))].sort((a,b)=>b-a);
   return `<article data-anchor="${esc(id)}"><h3>${esc(anchor.anchorLabel)} · az ${anchor.anchorAzimuth}° / el ${anchor.anchorElevation}°</h3>${pitches.map(pitch=>{const row=neighborhood.filter(p=>p.pitchOffset===pitch).sort((a,b)=>a.yawOffset-b.yawOffset);return `<div class="local-row" style="--columns:${row.length}">${row.map(cell).join('')}</div>`;}).join('')}</article>`;
  }).join('')||'<p>No local neighborhoods captured at this magnification.</p>';
 };
 const initial=Math.floor(distances.length/2),modes=['paired',...variants];
 return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
 body{background:#16181b;color:#eee;font:15px system-ui;margin:20px}h1{font-size:24px}h3{font-size:17px}h4{font-size:13px;margin:5px}.pair{display:flex;gap:3px}figure{margin:0;flex:1;min-width:0}img{width:100%;display:block}section{background:#24272c;padding:4px;min-width:0}a{color:#9df}button{padding:8px 14px;margin:4px;background:#343943;color:white;border:1px solid #738299;cursor:pointer}button[aria-pressed=true]{background:#155378}.scroll{overflow-x:auto}.strip{display:grid;grid-template-columns:repeat(var(--columns),minmax(220px,1fr));gap:8px}.local-row{display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:8px;margin:8px 0}article{margin-bottom:28px}figure[hidden],[hidden]{display:none!important}figcaption{font-size:12px}
 </style></head><body><h1>${esc(title)}</h1><p>Fixed lights · ${poses.length} camera poses · source and learned share each camera. Click a frame for its full capture.</p>
 <nav>Study: <button data-study="overview" aria-pressed="true">Hemisphere overview</button><button data-study="local" aria-pressed="false">Local angular matrices</button></nav>
 <nav>Camera distance: ${distances.map((d,i)=>`<button data-pick="${i}" aria-pressed="${i===initial}">${d.toFixed(3)} world units</button>`).join('')}</nav>
 <nav>Show: ${modes.map(mode=>`<button data-mode="${esc(mode)}" aria-pressed="${mode==='paired'}">${esc(mode)}</button>`).join('')}</nav>
 <p>Overview: each horizontal strip moves continuously around azimuth; its ends wrap. Higher elevation is above lower elevation. Local matrices: left/right changes azimuth, up/down changes elevation around a named anchor. Opposed anchors inspect distinct sides; they do not extend the material’s trained hemisphere. <a href="${esc(reportUrl)}">Source, checkpoint, poses and effective routes</a>.</p>
 ${distances.map((d,i)=>`<div data-distance="${i}" ${i===initial?'':'hidden'}><div data-content="overview">${overview(d)}</div><div data-content="local" hidden>${local(d)}</div></div>`).join('')}
 <script>
 document.querySelectorAll('button[data-pick]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-distance]').forEach(s=>s.hidden=s.dataset.distance!==b.dataset.pick);document.querySelectorAll('button[data-pick]').forEach(x=>x.setAttribute('aria-pressed',x===b));});
 document.querySelectorAll('button[data-study]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-content]').forEach(s=>s.hidden=s.dataset.content!==b.dataset.study);document.querySelectorAll('button[data-study]').forEach(x=>x.setAttribute('aria-pressed',x===b));});
 document.querySelectorAll('button[data-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('figure[data-variant]').forEach(f=>f.hidden=b.dataset.mode!=='paired'&&f.dataset.variant!==b.dataset.mode);document.querySelectorAll('button[data-mode]').forEach(x=>x.setAttribute('aria-pressed',x===b));});
 </script></body></html>`;
}
