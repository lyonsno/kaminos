import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

export const ATLAS_SCHEMA = 'kaminos.glyph-atlas.v0';
export const BUILD_REPORT_SCHEMA = 'kaminos.glyph-atlas.build-report.v0';
export const SOURCE_SCHEMA = 'kaminos.glyph-atlas.sources.v0';
export const REQUIRED_TEXT = 'KAMINOS';
export const FONTCONFIG_FIELD = '\u001f';
export const FONTCONFIG_ROW = '\u001e';
export const FONTCONFIG_FORMAT = [
  '%{file}',
  '%{index}',
  '%{family}',
  '%{style}',
  '%{fullname}',
  '%{postscriptname}',
  '%{fontformat}',
  '%{foundry}',
  '%{variable}',
  '%{charset}',
].join(FONTCONFIG_FIELD) + FONTCONFIG_ROW;

const REQUIRED_CODEPOINTS = [...new Set([...REQUIRED_TEXT].map(character => character.codePointAt(0)))];

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function firstName(value, fallback) {
  return value?.split(',').map(item => item.trim()).find(Boolean) || fallback;
}

function charsetIncludes(charset, codepoint) {
  if (!charset) return null;
  for (const token of charset.trim().split(/\s+/)) {
    if (!token) continue;
    const [lowText, highText = lowText] = token.split('-');
    const low = Number.parseInt(lowText, 16);
    const high = Number.parseInt(highText, 16);
    if (Number.isFinite(low) && Number.isFinite(high) && codepoint >= low && codepoint <= high) return true;
  }
  return false;
}

export function supportsRequiredText(charset) {
  const answers = REQUIRED_CODEPOINTS.map(codepoint => charsetIncludes(charset, codepoint));
  return answers.every(answer => answer === null) ? null : answers.every(Boolean);
}

export function parseFontconfigRows(raw, source) {
  const rows = raw.split(FONTCONFIG_ROW).map(row => row.trim()).filter(Boolean);
  return rows.map(row => {
    const [
      file,
      indexText,
      familyRaw,
      styleRaw,
      fullnameRaw,
      postscriptRaw,
      fontFormat,
      foundry,
      variableRaw,
      charset = '',
    ] = row.split(FONTCONFIG_FIELD);
    const index = Number.parseInt(indexText || '0', 10);
    const family = firstName(familyRaw, basename(file || 'Unknown'));
    const style = firstName(styleRaw, 'Regular');
    const fullName = firstName(fullnameRaw, `${family} ${style}`);
    const postscriptName = firstName(postscriptRaw, null);
    const identity = `${source.id}\0${resolve(file)}\0${Number.isFinite(index) ? index : 0}\0${postscriptName || fullName}`;
    return {
      id: `${sha256(identity).slice(0, 16)}-${Number.isFinite(index) ? index : 0}`,
      file: resolve(file),
      index: Number.isFinite(index) ? index : 0,
      family,
      style,
      fullName,
      postscriptName,
      fontFormat: fontFormat || null,
      foundry: foundry || null,
      variable: variableRaw === 'True',
      requiredTextCoverage: supportsRequiredText(charset),
      source: {
        id: source.id,
        kind: source.kind,
        root: source.root ? resolve(source.root) : null,
        url: source.url || null,
        ref: source.ref || null,
      },
      license: {
        status: source.license?.status || 'unknown',
        id: source.license?.id || null,
        url: source.license?.url || null,
        path: source.license?.path ? resolve(source.root || '.', source.license.path) : null,
      },
      assetHref: null,
    };
  });
}

export function buildAtlasModel({
  configIdentity,
  requestedSources,
  effectiveSources,
  faces,
  warnings,
  diagnosticThreshold = 1000,
}) {
  const sortedFaces = [...faces].sort((left, right) =>
    Number(left.family.startsWith('.')) - Number(right.family.startsWith('.')) ||
    left.family.localeCompare(right.family) ||
    left.style.localeCompare(right.style) ||
    left.id.localeCompare(right.id));
  const mohelIndicators = sortedFaces.length > diagnosticThreshold ? [{
    kind: 'uncapped-flow',
    count: sortedFaces.length,
    threshold: diagnosticThreshold,
    message: `Corpus contains ${sortedFaces.length} faces; all remain emitted.`,
  }] : [];
  return {
    schema: ATLAS_SCHEMA,
    configIdentity,
    requiredText: REQUIRED_TEXT,
    route: {
      requestedSources: [...requestedSources],
      effectiveSources: [...effectiveSources],
    },
    accounting: {
      discoveredFaces: faces.length,
      emittedFaces: sortedFaces.length,
      silentlyDroppedFaces: 0,
    },
    warnings: [...warnings],
    mohelIndicators,
    faces: sortedFaces,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function jsString(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function fontSource(face) {
  const sources = [];
  if (face.postscriptName) sources.push(`local("${String(face.postscriptName).replaceAll('"', '\\"')}")`);
  if (face.assetHref) sources.push(`url("${String(face.assetHref).replaceAll('"', '\\"')}")`);
  return sources.join(', ');
}

export function renderAtlasHtml(model) {
  const sourceOptions = model.route.effectiveSources
    .filter(source => source.status === 'loaded')
    .map(source => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.id)} · ${source.faceCount}</option>`)
    .join('');
  const fontFaces = model.faces.map(face => {
    const source = fontSource(face);
    return source ? `@font-face{font-family:"atlas-${face.id}";src:${source};font-display:block;}` : '';
  }).join('\n');
  const faceCards = model.faces.map(face => {
    const letters = [...model.requiredText].map((glyph, glyphIndex) =>
      `<button class="glyph" type="button" data-glyph="${escapeHtml(glyph)}" data-glyph-index="${glyphIndex}" title="Select ${escapeHtml(glyph)}">${escapeHtml(glyph)}</button>`).join('');
    const haystack = `${face.family} ${face.style} ${face.fullName} ${face.postscriptName || ''} ${face.source.id} ${face.foundry || ''}`.toLowerCase();
    return `<article class="face" data-face-id="${face.id}" data-source="${escapeHtml(face.source.id)}" data-license="${escapeHtml(face.license.status)}" data-search="${escapeHtml(haystack)}" style="--face-font:'atlas-${face.id}'">
      <header><div><strong>${escapeHtml(face.family)}</strong><span>${escapeHtml(face.style)}</span></div><code>${escapeHtml(face.source.id)}</code></header>
      <div class="word">${model.requiredText}</div>
      <div class="glyphs">${letters}</div>
      <footer><span>${escapeHtml(face.fontFormat || 'unknown')}</span><span>${escapeHtml(face.license.id || face.license.status)}</span><span>${escapeHtml(face.postscriptName || `index ${face.index}`)}</span></footer>
    </article>`;
  }).join('\n');
  const facePayload = Object.fromEntries(model.faces.map(face => [face.id, {
    id: face.id,
    family: face.family,
    style: face.style,
    fullName: face.fullName,
    source: face.source,
    license: face.license,
  }]));
  return `<!doctype html>
<html lang="en" data-atlas-schema="${ATLAS_SCHEMA}" data-config-identity="${escapeHtml(model.configIdentity)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kaminos Glyph Atlas</title>
<style>
${fontFaces}
:root{color-scheme:light;--ink:#11110f;--paper:#f2f0ea;--line:#c9c6bc;--accent:#e3532f;--panel:#fff;letter-spacing:0}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0}
button,input,select{font:inherit;letter-spacing:0}
.toolbar{position:sticky;top:0;z-index:10;display:grid;grid-template-columns:minmax(270px,1fr) 180px 220px auto auto;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);background:rgba(242,240,234,.96);backdrop-filter:blur(12px)}
.brand{display:flex;align-items:baseline;gap:12px;min-width:0}.brand b{font:800 19px/1 Arial,sans-serif}.brand span{color:#67645c;white-space:nowrap}
.control{height:34px;border:1px solid var(--line);border-radius:4px;background:#fff;padding:0 10px;color:var(--ink);min-width:0}
.segments{display:flex;height:34px;border:1px solid var(--line);border-radius:4px;overflow:hidden;background:#fff}
.segments button{border:0;border-right:1px solid var(--line);background:#fff;padding:0 11px;color:#5a574f}.segments button:last-child{border-right:0}.segments button.active{background:var(--ink);color:#fff}
.status{display:flex;gap:10px;align-items:center;justify-content:flex-end;white-space:nowrap}.status .mohel{color:#9b351e}
.atlas{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1px;background:var(--line);border-bottom:1px solid var(--line)}
.face{min-width:0;background:var(--panel);padding:11px 12px 10px}
.face>header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.face>header>div{display:flex;gap:8px;min-width:0}.face strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.face header span,.face footer{color:#757168}.face code{font-size:10px;color:#8a867c;white-space:nowrap}
.word{height:86px;display:flex;align-items:center;overflow:hidden;font-family:var(--face-font),sans-serif;font-size:52px;line-height:1;white-space:nowrap}
.glyphs{display:grid;grid-template-columns:repeat(7,1fr);height:67px;border:1px solid #dfddd6}
.glyph{min-width:0;border:0;border-right:1px solid #dfddd6;background:#faf9f6;font-family:var(--face-font),sans-serif;font-size:36px;line-height:1;cursor:pointer}.glyph:last-child{border-right:0}.glyph:hover,.glyph.selected{background:#171714;color:#fff}
.face footer{display:flex;gap:9px;margin-top:8px;font-size:10px;overflow:hidden}.face footer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body[data-view="word"] .glyphs{display:none}body[data-view="word"] .word{height:132px}
body[data-view="glyph"] .word{display:none}body[data-view="glyph"] .glyphs{height:132px}
.export{position:fixed;right:14px;bottom:14px;z-index:20;display:none;grid-template-columns:92px minmax(190px,1fr) auto;gap:10px;align-items:center;width:min(480px,calc(100vw - 28px));padding:10px;border:1px solid #333;background:#111;color:#fff;box-shadow:0 8px 35px rgba(0,0,0,.3)}
.export.visible{display:grid}.export canvas{width:92px;height:92px;background:#fff}.export div{min-width:0}.export strong,.export span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.export span{color:#bdb9ae}.export button{height:34px;border:1px solid #777;border-radius:4px;background:#fff;color:#111;padding:0 11px;cursor:pointer}
.empty{display:none;padding:50px;text-align:center;color:#777}.empty.visible{display:block}
@media(max-width:760px){.toolbar{grid-template-columns:1fr 1fr}.brand{grid-column:1/-1}.status{display:none}.atlas{grid-template-columns:1fr}.export{grid-template-columns:72px 1fr auto}.export canvas{width:72px;height:72px}}
</style>
</head>
<body data-view="all">
<section class="toolbar">
  <div class="brand"><b>KAMINOS GLYPH ATLAS</b><span>${model.accounting.emittedFaces} faces</span></div>
  <input id="search" class="control" type="search" placeholder="Family, style, foundry">
  <select id="source" class="control"><option value="">All sources</option>${sourceOptions}</select>
  <div class="segments" aria-label="Atlas view"><button type="button" data-view="all" class="active">All</button><button type="button" data-view="word">Word</button><button type="button" data-view="glyph">Glyphs</button></div>
  <div class="status"><span>${escapeHtml(model.configIdentity.slice(0, 12))}</span>${model.mohelIndicators.length ? `<span class="mohel">uncapped ${model.accounting.emittedFaces}</span>` : ''}</div>
</section>
<main id="atlas" class="atlas">${faceCards}</main>
<div id="empty" class="empty">No matching faces</div>
<aside id="export" class="export">
  <canvas id="plate" width="1024" height="1024"></canvas>
  <div><strong id="selection-name"></strong><span id="selection-source"></span></div>
  <button id="download" type="button" title="Download conditioning plate">PNG</button>
</aside>
<script>
const FACE_DATA=${jsString(facePayload)};
const cards=[...document.querySelectorAll('.face')];
const search=document.querySelector('#search');
const source=document.querySelector('#source');
const empty=document.querySelector('#empty');
const exportPanel=document.querySelector('#export');
const canvas=document.querySelector('#plate');
const context=canvas.getContext('2d');
let selected=null;
function filter(){
  const query=search.value.trim().toLowerCase();
  const sourceId=source.value;
  let shown=0;
  for(const card of cards){
    const visible=(!query||card.dataset.search.includes(query))&&(!sourceId||card.dataset.source===sourceId);
    card.hidden=!visible;if(visible)shown++;
  }
  empty.classList.toggle('visible',shown===0);
}
search.addEventListener('input',filter);source.addEventListener('change',filter);
for(const button of document.querySelectorAll('[data-view]')){
  button.addEventListener('click',()=>{
    document.body.dataset.view=button.dataset.view;
    document.querySelectorAll('[data-view]').forEach(item=>item.classList.toggle('active',item===button));
  });
}
function drawPlate(){
  if(!selected)return;
  const {card,glyph}=selected;
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle='#000';context.textAlign='center';context.textBaseline='middle';
  context.font='760px '+getComputedStyle(card).getPropertyValue('--face-font');
  context.fillText(glyph,canvas.width/2,canvas.height/2+35);
}
for(const button of document.querySelectorAll('.glyph')){
  button.addEventListener('click',async()=>{
    document.querySelectorAll('.glyph.selected').forEach(item=>item.classList.remove('selected'));
    button.classList.add('selected');
    const card=button.closest('.face');
    selected={card,glyph:button.dataset.glyph,face:FACE_DATA[card.dataset.faceId]};
    await document.fonts.ready;drawPlate();
    document.querySelector('#selection-name').textContent=selected.face.fullName+' · '+selected.glyph;
    document.querySelector('#selection-source').textContent=selected.face.source.id+' · '+(selected.face.license.id||selected.face.license.status);
    exportPanel.classList.add('visible');
  });
}
document.querySelector('#download').addEventListener('click',()=>{
  if(!selected)return;
  const link=document.createElement('a');
  link.download=(selected.face.family+'-'+selected.face.style+'-'+selected.glyph).replace(/[^a-z0-9._-]+/gi,'-').toLowerCase()+'.png';
  link.href=canvas.toDataURL('image/png');link.click();
});
const requestedSelection=new URLSearchParams(location.search);
const requestedFace=requestedSelection.get('face');
const requestedGlyph=requestedSelection.get('glyph');
if(requestedFace&&requestedGlyph){
  const requestedCard=document.querySelector('.face[data-face-id="'+CSS.escape(requestedFace)+'"]');
  const requestedButton=[...(requestedCard?.querySelectorAll('.glyph')||[])].find(button=>button.dataset.glyph===requestedGlyph);
  requestedButton?.click();
}
document.documentElement.dataset.effectiveUrl=location.href;
</script>
</body>
</html>`;
}
