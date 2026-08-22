import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const browserDir = path.dirname(new URL(import.meta.url).pathname);
const artifactRoot = path.dirname(browserDir);
const imagePattern = /\.(png|jpe?g|webp)$/i;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === browserDir) return [];
      return walk(fullPath);
    }
    return imagePattern.test(entry.name) ? [fullPath] : [];
  });
}

function titleCase(value) {
  return value
    .replace(/-2026-08-(21|22)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/Flux/g, "FLUX")
    .replace(/Trellis/g, "TRELLIS");
}

function classify(relativePath) {
  const lower = relativePath.toLowerCase();
  if (/(^|\/)sources?(\/|$)/.test(lower)) return "source";
  if (/(witness|operator-smoke|screenshot|capture|render)/.test(lower)) return "witness";
  if (/(sheet|contact|comparison|montage)/.test(lower)) return "comparison";
  if (/(^|\/)output\.(png|jpe?g|webp)$/.test(lower)) return "output";
  return "other";
}

function compactLabel(relativePath) {
  const parts = relativePath.split("/");
  const filename = parts.pop().replace(imagePattern, "");
  const useful = parts.slice(-4).filter((part) => !["cells", "wave-1", "wave-2", "images"].includes(part));
  if (filename !== "output") useful.push(filename);
  return useful.length ? useful.join(" / ") : filename;
}

function safeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

const images = walk(artifactRoot)
  .sort((a, b) => a.localeCompare(b))
  .map((absolutePath, index) => {
    const artifactPath = path.relative(artifactRoot, absolutePath);
    const groupId = artifactPath.includes("/") ? artifactPath.split("/")[0] : "_root";
    const stat = fs.statSync(absolutePath);
    return {
      id: index + 1,
      artifact_path: artifactPath,
      browser_src: `../${artifactPath}`,
      group_id: groupId,
      kind: classify(artifactPath),
      label: compactLabel(groupId === "_root" ? artifactPath : artifactPath.slice(groupId.length + 1)),
      bytes: stat.size,
    };
  });

const groupIds = [...new Set(images.map((image) => image.group_id))];
const groups = groupIds.map((id) => {
  const groupImages = images.filter((image) => image.group_id === id);
  const page = `group-${safeId(id)}.html`;
  const directory = id === "_root" ? artifactRoot : path.join(artifactRoot, id);
  const references = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(README|.*review).*\.md$|.*receipt.*\.json$/i.test(entry.name))
    .map((entry) => id === "_root" ? `../${entry.name}` : `../${id}/${entry.name}`)
    .sort();
  return {
    id,
    title: id === "_root" ? "Root Sources" : titleCase(id),
    page,
    image_count: groupImages.length,
    kind_counts: Object.fromEntries(["output", "source", "witness", "comparison", "other"].map((kind) => [kind, groupImages.filter((image) => image.kind === kind).length])),
    references,
  };
});

const generatedAt = new Date().toISOString();
const manifest = {
  schema: "kaminos.handy_candyman.operator_image_browser.v1",
  generated_at: generatedAt,
  artifact_root: artifactRoot,
  claim_boundary: "Complete browsing inventory of image files under the skull-muzzle artifact family; inclusion is not promotion or visual-quality evidence.",
  image_count: images.length,
  groups,
  images,
};

const sharedCss = `
:root { color-scheme: dark; --bg:#11110f; --panel:#1b1b18; --panel2:#24231f; --ink:#f1ede5; --muted:#aaa59c; --line:#3a3831; --accent:#f0a35b; --teal:#55b8aa; --danger:#d96b66; }
* { box-sizing:border-box; }
html, body { margin:0; min-height:100%; background:var(--bg); color:var(--ink); font:14px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; letter-spacing:0; }
body { padding:0 0 56px; }
a { color:inherit; text-decoration:none; }
button, input { font:inherit; letter-spacing:0; }
.topbar { position:sticky; z-index:20; top:0; display:flex; align-items:center; gap:14px; min-height:62px; padding:10px 18px; background:rgba(17,17,15,.96); border-bottom:1px solid var(--line); backdrop-filter:blur(12px); }
.title { min-width:0; }
h1 { margin:0; font-size:20px; font-weight:720; }
.meta { margin-top:2px; color:var(--muted); font-size:12px; }
.tools { display:flex; align-items:center; gap:8px; margin-left:auto; }
.icon, .segment button { border:1px solid var(--line); color:var(--ink); background:var(--panel); border-radius:6px; cursor:pointer; }
.icon { width:38px; height:38px; display:grid; place-items:center; font-size:20px; }
.icon:hover, .segment button:hover { border-color:var(--accent); }
.search { width:min(300px,34vw); height:38px; border:1px solid var(--line); border-radius:6px; background:#0c0c0b; color:var(--ink); padding:0 12px; outline:none; }
.search:focus { border-color:var(--teal); }
.segment { display:flex; align-items:center; gap:4px; }
.segment button { height:34px; padding:0 10px; color:var(--muted); }
.segment button.active { color:#17130e; background:var(--accent); border-color:var(--accent); font-weight:700; }
.content { width:min(1760px,calc(100% - 32px)); margin:22px auto; }
.group-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); gap:14px; }
.group { display:block; overflow:hidden; border:1px solid var(--line); border-radius:7px; background:var(--panel); }
.group:hover { border-color:var(--accent); }
.strip { display:grid; grid-template-columns:repeat(4,1fr); aspect-ratio:3.2/1; background:#090908; }
.strip img { width:100%; height:100%; object-fit:cover; min-width:0; }
.group-copy { display:flex; align-items:center; gap:12px; padding:13px 14px; }
.group-copy strong { font-size:15px; }
.group-copy span { margin-left:auto; color:var(--muted); font-variant-numeric:tabular-nums; }
.gallery { --tile:220px; display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--tile)),1fr)); gap:10px; }
.tile { min-width:0; overflow:hidden; border:1px solid var(--line); border-radius:6px; background:var(--panel); cursor:pointer; }
.tile:hover { border-color:var(--accent); }
.thumb { position:relative; aspect-ratio:1; background:#080807; }
.thumb img { width:100%; height:100%; object-fit:contain; display:block; }
.badge { position:absolute; top:7px; left:7px; padding:3px 6px; border-radius:4px; background:rgba(0,0,0,.76); color:#fff; font-size:10px; text-transform:uppercase; }
.caption { min-height:50px; padding:8px 9px; border-top:1px solid var(--line); }
.caption strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
.caption small { color:var(--muted); }
.empty { display:none; padding:64px 20px; color:var(--muted); text-align:center; }
.range { width:110px; accent-color:var(--accent); }
.modal { position:fixed; z-index:50; inset:0; display:none; grid-template-rows:1fr auto; padding:18px; background:rgba(0,0,0,.9); }
.modal.open { display:grid; }
.modal-image { width:100%; height:calc(100vh - 104px); object-fit:contain; }
.modal-bar { display:flex; align-items:center; gap:10px; min-height:56px; padding:8px 10px; background:#090908; border:1px solid var(--line); border-radius:6px; }
.modal-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.modal-path { color:var(--muted); font-size:11px; }
.modal-nav { display:flex; gap:6px; margin-left:auto; }
.refs { display:flex; gap:7px; flex-wrap:wrap; margin:0 0 16px; }
.ref { padding:5px 8px; border:1px solid var(--line); border-radius:5px; color:var(--muted); }
.ref:hover { color:var(--ink); border-color:var(--teal); }
@media (max-width:760px) { .topbar { align-items:flex-start; flex-wrap:wrap; } .tools { width:100%; margin:0; overflow-x:auto; } .search { width:100%; min-width:170px; } .content { width:min(100% - 18px,1760px); margin-top:12px; } .group-grid { grid-template-columns:1fr; } .gallery { --tile:170px; } .range { display:none; } .modal { padding:6px; } }
`;

function chrome(title, subtitle, body, extraTools = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${sharedCss}</style></head><body>${body}${extraTools}</body></html>`;
}

function galleryPage(title, subtitle, pageImages, references = []) {
  const items = jsonForHtml(pageImages);
  const refs = references.map((href) => `<a class="ref" href="${href}">${path.basename(href)}</a>`).join("");
  const body = `
  <header class="topbar"><a class="icon" href="index.html" title="All assays">⌂</a><div class="title"><h1>${title}</h1><div class="meta">${subtitle}</div></div><div class="tools"><input class="search" id="search" type="search" placeholder="Filter paths"><div class="segment" id="segments"></div><input class="range" id="size" title="Thumbnail size" type="range" min="150" max="360" value="220"></div></header>
  <main class="content">${refs ? `<nav class="refs">${refs}</nav>` : ""}<section class="gallery" id="gallery"></section><div class="empty" id="empty">No matching images</div></main>
  <div class="modal" id="modal"><img class="modal-image" id="modalImage"><div class="modal-bar"><div class="modal-label"><strong id="modalLabel"></strong><div class="modal-path" id="modalPath"></div></div><div class="modal-nav"><button class="icon" id="previous" title="Previous">‹</button><a class="icon" id="openOriginal" title="Open original">↗</a><button class="icon" id="next" title="Next">›</button><button class="icon" id="close" title="Close">×</button></div></div></div>
  <script>
  const items=${items}; let activeKind="all"; let visible=[]; let modalIndex=-1;
  const kinds=["all",...new Set(items.map(item=>item.kind))];
  const gallery=document.getElementById("gallery"), search=document.getElementById("search"), empty=document.getElementById("empty"), segments=document.getElementById("segments");
  segments.innerHTML=kinds.map(kind=>'<button data-kind="'+kind+'">'+kind+'</button>').join('');
  function render(){ const query=search.value.trim().toLowerCase(); visible=items.filter(item=>(activeKind==="all"||item.kind===activeKind)&&(!query||(item.artifact_path+" "+item.label).toLowerCase().includes(query))); gallery.innerHTML=visible.map((item,index)=>'<article class="tile" data-index="'+index+'"><div class="thumb"><img loading="lazy" decoding="async" src="'+item.browser_src+'" alt=""><span class="badge">'+item.kind+'</span></div><div class="caption"><strong>'+item.label+'</strong><small>'+Math.round(item.bytes/1024)+' KB</small></div></article>').join(''); empty.style.display=visible.length?'none':'block'; segments.querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.kind===activeKind)); }
  function show(index){ if(!visible.length)return; modalIndex=(index+visible.length)%visible.length; const item=visible[modalIndex]; document.getElementById("modalImage").src=item.browser_src; document.getElementById("modalLabel").textContent=item.label; document.getElementById("modalPath").textContent=item.artifact_path; document.getElementById("openOriginal").href=item.browser_src; document.getElementById("modal").classList.add("open"); }
  segments.addEventListener('click',event=>{ if(event.target.dataset.kind){ activeKind=event.target.dataset.kind; render(); }}); search.addEventListener('input',render); gallery.addEventListener('click',event=>{ const tile=event.target.closest('.tile'); if(tile)show(Number(tile.dataset.index)); }); document.getElementById('size').addEventListener('input',event=>gallery.style.setProperty('--tile',event.target.value+'px')); document.getElementById('previous').onclick=()=>show(modalIndex-1); document.getElementById('next').onclick=()=>show(modalIndex+1); document.getElementById('close').onclick=()=>document.getElementById('modal').classList.remove('open'); document.getElementById('modal').addEventListener('click',event=>{if(event.target.id==='modal')event.currentTarget.classList.remove('open')}); document.addEventListener('keydown',event=>{if(event.key==='Escape')document.getElementById('modal').classList.remove('open'); if(event.key==='ArrowLeft')show(modalIndex-1); if(event.key==='ArrowRight')show(modalIndex+1)}); render();
  </script>`;
  return chrome(title, subtitle, body);
}

for (const group of groups) {
  const groupImages = images.filter((image) => image.group_id === group.id);
  fs.writeFileSync(path.join(browserDir, group.page), galleryPage(group.title, `${group.image_count} images · ${group.id}`, groupImages, group.references));
}

fs.writeFileSync(path.join(browserDir, "all.html"), galleryPage("All Images", `${images.length} images across ${groups.length} assays`, images));

const groupCards = groups.map((group) => {
  const groupImages = images.filter((image) => image.group_id === group.id);
  const preferred = [...groupImages.filter((image) => image.kind === "output"), ...groupImages.filter((image) => image.kind !== "output")].slice(0, 4);
  return `<a class="group" href="${group.page}"><div class="strip">${preferred.map((image) => `<img loading="lazy" decoding="async" src="${image.browser_src}" alt="">`).join("")}</div><div class="group-copy"><strong>${group.title}</strong><span>${group.image_count}</span></div></a>`;
}).join("");

const indexBody = `<header class="topbar"><div class="title"><h1>Operator Image Browser</h1><div class="meta">${images.length} images · ${groups.length} assays · generated ${generatedAt}</div></div><div class="tools"><a class="icon" href="all.html" title="All images">⊞</a></div></header><main class="content" data-total-images="${images.length}"><section class="group-grid">${groupCards}</section></main>`;
fs.writeFileSync(path.join(browserDir, "index.html"), chrome("Operator Image Browser", `${images.length} images`, indexBody));
fs.writeFileSync(path.join(browserDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const digest = crypto.createHash("sha256").update(JSON.stringify(manifest.images)).digest("hex");
console.log(`built ${images.length} images across ${groups.length} groups; inventory digest ${digest}`);
