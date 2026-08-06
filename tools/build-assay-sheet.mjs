#!/usr/bin/env node
/**
 * Build a self-contained operator contact sheet for a set of generation cells.
 *
 * Every row shows the conditioning plate, the output, and the exact prompt text
 * that produced it, with the trailing exclusion clause split out so it is
 * visible rather than buried mid-paragraph. Images are inlined as data URIs so
 * the sheet is one portable file.
 *
 * The point is that no cell's identity depends on anyone's recollection.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function dataUri(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Split a prompt into its positive body and its trailing exclusion clause.
 * This route has no separate negative-prompt field; exclusions live inline, so
 * surfacing them separately prevents "did that cell have a negative prompt?"
 * from ever being a guess.
 */
function splitPrompt(text) {
  const trimmed = text.trim();
  const sentences = trimmed.split(/(?<=\.)\s+/);
  const exclusionIndex = sentences.findIndex((s) => /^(no |keep the body continuous|avoid )/i.test(s.trim()));
  if (exclusionIndex === -1) return { positive: trimmed, exclusion: null };
  return {
    positive: sentences.slice(0, exclusionIndex).join(' ').trim(),
    exclusion: sentences.slice(exclusionIndex).join(' ').trim(),
  };
}

const specPath = resolve(process.argv[2]);
const outPath = resolve(process.argv[3]);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

const rows = spec.cells.map((cell) => {
  const promptText = readFileSync(resolve(cell.promptPath), 'utf8');
  const { positive, exclusion } = splitPrompt(promptText);
  return {
    ...cell,
    promptName: basename(cell.promptPath),
    promptSha: sha256(resolve(cell.promptPath)),
    plateSha: sha256(resolve(cell.platePath)),
    outputSha: sha256(resolve(cell.outputPath)),
    plateUri: dataUri(resolve(cell.platePath)),
    outputUri: dataUri(resolve(cell.outputPath)),
    positive,
    exclusion,
  };
});

const html = `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(spec.title)}</title>
<style>
  body { background:#141618; color:#e8e6e3; font:14px/1.55 -apple-system,BlinkMacSystemFont,sans-serif; margin:0; padding:28px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#9aa0a6; margin-bottom:24px; }
  .cell { border:1px solid #2c3034; border-radius:10px; margin-bottom:22px; overflow:hidden; }
  .hd { display:flex; align-items:baseline; gap:12px; padding:12px 16px; background:#1b1e21; border-bottom:1px solid #2c3034; }
  .id { font-weight:600; font-size:15px; }
  .verdict { font-size:12px; padding:2px 9px; border-radius:20px; font-weight:600; }
  .adhered { background:#1d3a24; color:#7ee08f; }
  .collapsed { background:#3a1d1d; color:#ef8b8b; }
  .unscored { background:#2c3034; color:#9aa0a6; }
  .body { display:grid; grid-template-columns:260px 260px 1fr; gap:16px; padding:16px; }
  .body img { width:100%; border-radius:6px; background:#000; display:block; }
  .lbl { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:#8a9098; margin-bottom:6px; }
  .prompt { font-size:13px; }
  .pos { background:#191c1f; border-left:3px solid #4a90d9; padding:9px 12px; border-radius:0 5px 5px 0; white-space:pre-wrap; }
  .exc { background:#201a1a; border-left:3px solid #d97b4a; padding:9px 12px; margin-top:9px; border-radius:0 5px 5px 0; white-space:pre-wrap; }
  .meta { font-family:ui-monospace,Menlo,monospace; font-size:10.5px; color:#767c84; margin-top:10px; line-height:1.7; }
  .note { font-size:12.5px; color:#b9bec4; margin-top:9px; font-style:italic; }
  @media (max-width:1100px){ .body{ grid-template-columns:1fr; } }
</style>
<h1>${escapeHtml(spec.title)}</h1>
<div class="sub">${escapeHtml(spec.subtitle || '')}</div>
${rows.map((r) => `
<div class="cell">
  <div class="hd">
    <span class="id">${escapeHtml(r.id)}</span>
    <span class="verdict ${r.verdict || 'unscored'}">${escapeHtml((r.verdict || 'unscored').toUpperCase())}</span>
    <span style="color:#767c84;font-size:12px">seed ${escapeHtml(String(r.seed))}</span>
  </div>
  <div class="body">
    <div>
      <div class="lbl">Conditioning plate</div>
      <img src="${r.plateUri}" alt="plate">
      <div class="meta">${escapeHtml(basename(r.platePath))}<br>${r.plateSha.slice(0, 16)}…</div>
    </div>
    <div>
      <div class="lbl">Output</div>
      <img src="${r.outputUri}" alt="output">
      <div class="meta">${r.outputSha.slice(0, 16)}…</div>
    </div>
    <div>
      <div class="lbl">Prompt — ${escapeHtml(r.promptName)}</div>
      <div class="prompt">
        <div class="pos">${escapeHtml(r.positive)}</div>
        ${r.exclusion ? `<div class="exc"><b>Inline exclusion clause:</b> ${escapeHtml(r.exclusion)}</div>` : '<div class="note">No exclusion clause in this prompt.</div>'}
      </div>
      ${r.note ? `<div class="note">${escapeHtml(r.note)}</div>` : ''}
      <div class="meta">prompt sha ${r.promptSha.slice(0, 16)}…<br>${escapeHtml(spec.route || '')}</div>
    </div>
  </div>
</div>`).join('')}
<div class="sub" style="margin-top:20px">This route has no separate negative-prompt field. <code>mflux-generate-flux2-edit</code> accepts <code>--prompt-file</code> only; exclusions shown above are inline clauses within each prompt's own text.</div>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
process.stdout.write(`${JSON.stringify({ status: 'completed', sheet: outPath, cells: rows.length }, null, 2)}\n`);
