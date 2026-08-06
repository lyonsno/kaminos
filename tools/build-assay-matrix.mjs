#!/usr/bin/env node
/**
 * Build a plate x prompt matrix contact sheet.
 *
 * Cells are laid out on the two axes actually being varied, so "which variable
 * moved this" is readable at a glance rather than reconstructed from a linear
 * list. Column headers carry the full prompt text; row headers carry the plate.
 * Empty intersections are shown as unrun rather than omitted, so coverage gaps
 * are visible.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const uri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function splitPrompt(text) {
  const trimmed = text.trim();
  const sentences = trimmed.split(/(?<=\.)\s+/);
  const i = sentences.findIndex((s) => /^(no |keep the body continuous|avoid )/i.test(s.trim()));
  if (i === -1) return { positive: trimmed, exclusion: null };
  return {
    positive: sentences.slice(0, i).join(' ').trim(),
    exclusion: sentences.slice(i).join(' ').trim(),
  };
}

const spec = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
const outPath = resolve(process.argv[3]);

const byKey = new Map();
for (const cell of spec.cells) byKey.set(`${cell.plate}|${cell.prompt}`, cell);

const prompts = spec.prompts.map((p) => {
  const text = readFileSync(resolve(p.path), 'utf8');
  return { ...p, ...splitPrompt(text), sha: sha(resolve(p.path)), words: text.trim().split(/\s+/).length };
});

const html = `<!doctype html>
<meta charset="utf-8"><title>${esc(spec.title)}</title>
<style>
 body{background:#141618;color:#e8e6e3;font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;margin:0;padding:24px}
 h1{font-size:19px;margin:0 0 4px} .sub{color:#9aa0a6;margin-bottom:20px;font-size:12.5px}
 table{border-collapse:separate;border-spacing:8px;table-layout:fixed}
 th,td{vertical-align:top}
 .corner{width:150px}
 th.p{width:230px;background:#1b1e21;border:1px solid #2c3034;border-radius:8px;padding:10px;text-align:left}
 th.p .nm{font-size:13px;font-weight:700;margin-bottom:6px}
 th.p .tx{font-size:10.5px;line-height:1.45;color:#c3c8cd;max-height:150px;overflow:auto;white-space:pre-wrap}
 th.p .ex{font-size:10px;color:#d99b7a;margin-top:6px;border-top:1px solid #33383d;padding-top:5px;white-space:pre-wrap}
 th.p .wc{font-size:10px;color:#767c84;margin-top:5px;font-family:ui-monospace,Menlo,monospace}
 td.r{width:150px;background:#1b1e21;border:1px solid #2c3034;border-radius:8px;padding:8px;text-align:center}
 td.r img{width:100%;border-radius:5px;background:#000;display:block}
 td.r .nm{font-size:11.5px;font-weight:600;margin-top:6px}
 td.c{background:#1b1e21;border:1px solid #2c3034;border-radius:8px;padding:8px;text-align:center}
 td.c img{width:100%;border-radius:5px;background:#000;display:block}
 td.unrun{background:#17191b;border:1px dashed #2c3034;border-radius:8px;color:#5a6068;text-align:center;font-size:11px;padding:40px 8px}
 .v{font-size:10px;padding:2px 8px;border-radius:12px;font-weight:700;display:inline-block;margin-top:7px}
 .adhered{background:#1d3a24;color:#7ee08f} .collapsed{background:#3a1d1d;color:#ef8b8b}
 .unscored{background:#2c3034;color:#9aa0a6} .control{background:#2a2440;color:#b39ae0}
 .sh{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:#5f656c;margin-top:4px}
 .nt{font-size:10.5px;color:#a8aeb4;font-style:italic;margin-top:5px;text-align:left;line-height:1.4}
</style>
<h1>${esc(spec.title)}</h1>
<div class="sub">${esc(spec.subtitle || '')}</div>
<table>
<tr><td class="corner"></td>${prompts.map((p) => `<th class="p">
 <div class="nm">${esc(p.name)}</div>
 <div class="tx">${esc(p.positive)}</div>
 ${p.exclusion ? `<div class="ex"><b>excl:</b> ${esc(p.exclusion)}</div>` : '<div class="ex" style="color:#6b7078">no exclusion clause</div>'}
 <div class="wc">${p.words} words · ${p.sha.slice(0, 12)}…</div>
</th>`).join('')}</tr>
${spec.plates.map((plate) => `<tr>
 <td class="r"><img src="${uri(resolve(plate.path))}"><div class="nm">${esc(plate.name)}</div><div class="sh">${sha(resolve(plate.path)).slice(0, 12)}…</div></td>
 ${prompts.map((p) => {
    const cell = byKey.get(`${plate.id}|${p.id}`);
    if (!cell) return '<td class="unrun">unrun</td>';
    return `<td class="c">
   <img src="${uri(resolve(cell.outputPath))}">
   <div class="v ${cell.verdict || 'unscored'}">${esc((cell.verdict || 'unscored').toUpperCase())}</div>
   ${cell.note ? `<div class="nt">${esc(cell.note)}</div>` : ''}
   <div class="sh">${sha(resolve(cell.outputPath)).slice(0, 12)}…</div>
 </td>`;
  }).join('')}
</tr>`).join('')}
</table>
<div class="sub" style="margin-top:18px">${esc(spec.footer || '')}</div>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
process.stdout.write(`${JSON.stringify({ status: 'completed', sheet: outPath }, null, 2)}\n`);
