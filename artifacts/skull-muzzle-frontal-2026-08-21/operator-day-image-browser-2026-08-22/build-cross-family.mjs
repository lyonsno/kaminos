import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const browserDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(browserDir, "../../..");
const assetsDir = path.join(browserDir, "cross-family-assets");
const greenroomRoot = "/Users/noahlyons/.local/state/gpu-greenroom";

function requireFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`required evidence file is missing: ${filePath}`);
  }
  return filePath;
}

function copyExternal(source, relativeDestination) {
  requireFile(source);
  const destination = path.join(assetsDir, relativeDestination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return path.relative(browserDir, destination).split(path.sep).join("/");
}

function copyGitBlob(revision, sourcePath, relativeDestination) {
  const destination = path.join(assetsDir, relativeDestination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const contents = execFileSync("git", ["show", `${revision}:${sourcePath}`], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  fs.writeFileSync(destination, contents);
  return path.relative(browserDir, destination).split(path.sep).join("/");
}

function greenroomViewer(glbPath) {
  requireFile(glbPath);
  const relativePath = path.relative(greenroomRoot, glbPath).split(path.sep).join("/");
  if (relativePath.startsWith("..")) throw new Error(`GLB is outside the Greenroom mount: ${glbPath}`);
  return `http://127.0.0.1:8104/index.html?mesh_root=greenroom&mesh_path=${encodeURIComponent(relativePath)}`;
}

function localViewer(glbPath) {
  requireFile(glbPath);
  const relativePath = path.relative("/private/tmp", glbPath).split(path.sep).join("/");
  if (relativePath.startsWith("..")) throw new Error(`GLB is outside the lerms-preview mount: ${glbPath}`);
  return `http://127.0.0.1:8104/index.html?mesh_root=lerms-preview&mesh_path=${encodeURIComponent(relativePath)}`;
}

function copiedWitness(label, source, destination) {
  return { label, src: copyExternal(source, destination) };
}

function gitWitness(label, revision, source, destination) {
  return { label, src: copyGitBlob(revision, source, destination) };
}

function escapeHtml(value) {
  return String(value ?? "not recorded")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

fs.rmSync(assetsDir, { recursive: true, force: true });
fs.mkdirSync(assetsDir, { recursive: true });

const mainManifest = JSON.parse(fs.readFileSync(path.join(browserDir, "manifest.json"), "utf8"));
const highResolution = mainManifest.casts
  .filter((cast) => cast.assay === "trellis-high-resolution-assay-2026-08-22")
  .map((cast) => ({
    ...cast,
    family: "Skull-muzzle head",
    comparison_role: cast.settings.resolution === "1024" ? "High-resolution endpoint" : "High-resolution control",
    claim_ceiling: "Same-route skull comparison only. Resolution, cascade, texture size, and simplification remain coupled; visual quality is not monotonic evidence for any one parameter.",
    settings: { backend: "TRELLIS2/MLX native checkpoint", ...cast.settings },
  }));

if (highResolution.length !== 4) {
  throw new Error(`expected four skull high-resolution casts; found ${highResolution.length}`);
}

const catRevision = "1ab4fbd6";
const catRoot = "artifacts/polygonal-cat-roundtrip-v0/cycle-2";
const catInputSrc = copyGitBlob(catRevision, `${catRoot}/source/second-flux.png`, "polygonal-cat/input.png");
copyGitBlob(catRevision, `${catRoot}/reconstructions/trellis/output.glb`, "polygonal-cat/output.glb");
const catGlb = path.join(assetsDir, "polygonal-cat/output.glb");

const pixalInput = "/Users/noahlyons/dev/pixal3d/assets/images/9_img.png";
const pixalInputSrc = copyExternal(pixalInput, "pixal9/input.png");
const pixalMlxRoot = path.join(greenroomRoot, "outputs/trellis2mlx-happy-control-pixal9-20260803/trellis2mlx-current-aaec3ba-natural-mlx-source-native-finalizer-s42-steps8-tex1024");
const pixalMacRoot = path.join(greenroomRoot, "outputs/trellis2mlx-happy-control-pixal9-20260803/trellis-mac-d58628f-canonical-finalizer-s42-steps8-r512/viewer");

const gribbleInput = path.join(greenroomRoot, "outputs/kaminos-world-tracing-exporters-trellis-20260627T213412Z/ablate02-01-denser-interior_flood-alpha_trellis_source_rgba.png");
const gribbleInputSrc = copyExternal(gribbleInput, "gribble/input.png");
const gribbleCorrectedRoot = path.join(greenroomRoot, "outputs/gribble-fresh-edgeaxis-openmesh-normalfix-d3722e4-fast8-350k-1024-20260703");
const gribbleBaselineRoot = path.join(greenroomRoot, "outputs/gribble-winding-conflict-prune-fresh-9385f63-fast8-350k-4k-20260702");
const gribbleMacRoot = path.join(greenroomRoot, "outputs/gribble-trellis-mac-glb-reference-notexture-512-s42-steps8-20260707");

const controls = [
  {
    id: "polygonal-cat-cycle2-mlx",
    title: "Polygonal Cat Cycle 2",
    family: "Complete full-body organic character",
    comparison_role: "Low-cost coherent MLX control",
    glb_path: catGlb,
    viewer_url: localViewer(catGlb),
    input_src: catInputSrc,
    settings: { backend: "TRELLIS2/MLX fast", seed: 42, steps: 6, resolution: 512, cascade: "off", texture_size: 1024, target_faces: 200000, simplify_first: "on", runtime_s: 52.3 },
    claim_ceiling: "Proves this MLX route can complete a coherent full-body organic cast at inexpensive settings. It does not isolate why this basin succeeded.",
    witnesses: [
      gitWitness("Orbit 0 degrees", catRevision, `${catRoot}/reconstructions/trellis/orbit/az000-el12.png`, "polygonal-cat/orbit-000.png"),
      gitWitness("Orbit 120 degrees", catRevision, `${catRoot}/reconstructions/trellis/orbit/az120-el12.png`, "polygonal-cat/orbit-120.png"),
      gitWitness("Orbit 240 degrees", catRevision, `${catRoot}/reconstructions/trellis/orbit/az240-el12.png`, "polygonal-cat/orbit-240.png"),
    ],
  },
  {
    id: "pixal9-mlx",
    title: "Pixal9 Robot Crab - MLX",
    family: "Complete hard-surface character",
    comparison_role: "Distribution-friendly semantic control",
    glb_path: path.join(pixalMlxRoot, "output.glb"),
    viewer_url: greenroomViewer(path.join(pixalMlxRoot, "output.glb")),
    input_src: pixalInputSrc,
    settings: { backend: "TRELLIS2/MLX source-native finalizer", seed: 42, steps: 8, resolution: 512, cascade: "off", texture_size: 1024, target_faces: 350000, simplify_first: "QEM source-native", runtime_s: 218.9 },
    claim_ceiling: "Semantically coherent under two-sided rendering; explicit FrontSide witnesses expose winding holes. Independent backend noise prevents causal arithmetic attribution.",
    witnesses: [
      copiedWitness("Two-sided reference", path.join(pixalMlxRoot, "kaminos-mlx.png"), "pixal9/mlx-two-sided.png"),
      copiedWitness("FrontSide 0 degrees", path.join(pixalMlxRoot, "kaminos-mlx-frontside-roty0.png"), "pixal9/mlx-frontside-000.png"),
      copiedWitness("FrontSide 180 degrees", path.join(pixalMlxRoot, "kaminos-mlx-frontside-roty180.png"), "pixal9/mlx-frontside-180.png"),
    ],
  },
  {
    id: "pixal9-trellis-mac",
    title: "Pixal9 Robot Crab - Trellis-Mac",
    family: "Complete hard-surface character",
    comparison_role: "Same-input backend reference",
    glb_path: path.join(pixalMacRoot, "source-reference-final.glb"),
    viewer_url: greenroomViewer(path.join(pixalMacRoot, "source-reference-final.glb")),
    input_src: pixalInputSrc,
    settings: { backend: "Official TRELLIS.2 on PyTorch MPS plus canonical finalizer", seed: 42, steps: 8, resolution: 512, cascade: "off", texture_size: "untextured reference", target_faces: 350000, simplify_first: "canonical finalizer" },
    claim_ceiling: "FrontSide geometry is coherent on this source. Because its random tensor was independent from the MLX run, this is a differential phenotype, not backend-causal proof.",
    witnesses: [
      copiedWitness("Two-sided reference", path.join(pixalMacRoot, "kaminos-source-reference.png"), "pixal9/mac-two-sided.png"),
      copiedWitness("FrontSide 0 degrees", path.join(pixalMacRoot, "kaminos-source-frontside-roty0.png"), "pixal9/mac-frontside-000.png"),
      copiedWitness("FrontSide 180 degrees", path.join(pixalMacRoot, "kaminos-source-frontside-roty180.png"), "pixal9/mac-frontside-180.png"),
    ],
  },
  {
    id: "gribble-corrected-mlx",
    title: "Gribble - Corrected MLX Cleanup",
    family: "Dense hard-surface greeble box",
    comparison_role: "Downstream extraction and cleanup control",
    glb_path: path.join(gribbleCorrectedRoot, "output.glb"),
    viewer_url: greenroomViewer(path.join(gribbleCorrectedRoot, "output.glb")),
    input_src: gribbleInputSrc,
    settings: { backend: "TRELLIS2/MLX d3722e4", seed: 42, steps: 8, resolution: 512, cascade: "off", texture_size: 1024, target_faces: 350000, simplify_first: "on", runtime_s: 162.9 },
    claim_ceiling: "The extractor-axis and open-mesh normal fixes reduce corrected projected culling loss to 1.22%. Residual visual roughness and model-trajectory quality remain unresolved.",
    witnesses: [
      copiedWitness("Rendered object", path.join(gribbleCorrectedRoot, "render-witness-auto.png"), "gribble/corrected-render.png"),
      copiedWitness("Front faces", path.join(gribbleCorrectedRoot, "render-witness-auto/front_faces.png"), "gribble/corrected-front-faces.png"),
      copiedWitness("Double sided", path.join(gribbleCorrectedRoot, "render-witness-auto/double_sided.png"), "gribble/corrected-double-sided.png"),
    ],
  },
  {
    id: "gribble-baseline-mlx",
    title: "Gribble - Baseline MLX",
    family: "Dense hard-surface greeble box",
    comparison_role: "Pre-fix downstream control",
    glb_path: path.join(gribbleBaselineRoot, "output.glb"),
    viewer_url: greenroomViewer(path.join(gribbleBaselineRoot, "output.glb")),
    input_src: gribbleInputSrc,
    settings: { backend: "TRELLIS2/MLX 9385f63", seed: 42, steps: 8, resolution: 512, cascade: "off", texture_size: 4096, target_faces: 350000, simplify_first: "on", runtime_s: 237.7 },
    claim_ceiling: "Pre-fix comparison artifact with 15.62% corrected projected culling loss. Texture size also differs from the corrected run, so the pair is not a pure single-variable assay.",
    witnesses: [
      copiedWitness("Rendered object", path.join(gribbleBaselineRoot, "render-witness-auto.png"), "gribble/baseline-render.png"),
      copiedWitness("Front faces", path.join(gribbleBaselineRoot, "render-witness-auto/front_faces.png"), "gribble/baseline-front-faces.png"),
      copiedWitness("Double sided", path.join(gribbleBaselineRoot, "render-witness-auto/double_sided.png"), "gribble/baseline-double-sided.png"),
    ],
  },
  {
    id: "gribble-trellis-mac",
    title: "Gribble - Trellis-Mac",
    family: "Dense hard-surface greeble box",
    comparison_role: "Backend phenotype reference",
    glb_path: path.join(gribbleMacRoot, "output.glb"),
    viewer_url: greenroomViewer(path.join(gribbleMacRoot, "output.glb")),
    input_src: gribbleInputSrc,
    settings: { backend: "Trellis-Mac official pipeline", seed: 42, steps: 8, resolution: 512, cascade: "not recorded", texture_size: "untextured reference", target_faces: "not recorded", simplify_first: "not recorded", runtime_s: 309.5 },
    claim_ceiling: "Extant Trellis-Mac phenotype under the same named source and seed. Noise identity and postprocess parity are not established, so differences remain diagnostic rather than causal.",
    witnesses: [
      copiedWitness("KamiNOS smoke", path.join(gribbleMacRoot, "kaminos-smoke-20260803.png"), "gribble/mac-kaminos-smoke.png"),
    ],
  },
];

const casts = [...highResolution, ...controls];
for (const cast of casts) {
  requireFile(cast.glb_path);
  if (!cast.input_src || !fs.existsSync(path.join(browserDir, cast.input_src))) throw new Error(`input is missing for ${cast.id}`);
  if (!cast.witnesses.length) throw new Error(`witness inventory is empty for ${cast.id}`);
  for (const witness of cast.witnesses) requireFile(path.join(browserDir, witness.src));
}

const manifest = {
  schema: "kaminos.handy_candyman.cross_family_trellis_atlas.v1",
  generated_at: new Date().toISOString(),
  claim_boundary: "Curated visual comparison instrument. It binds sources, settings, extant GLBs, and witnesses but does not by itself establish backend or parameter causality.",
  casts,
};

const settingOrder = ["backend", "seed", "steps", "resolution", "cascade", "texture_size", "target_faces", "simplify_first", "runtime_s"];
const cards = casts.map((cast) => `
  <article class="cast" data-search="${escapeHtml(`${cast.title} ${cast.family} ${cast.comparison_role}`.toLowerCase())}">
    <header><div><h2>${escapeHtml(cast.title)}</h2><p>${escapeHtml(cast.family)} / ${escapeHtml(cast.comparison_role)}</p></div></header>
    <div class="body">
      <section><h3>Input</h3><a class="source" href="${escapeHtml(cast.input_src)}"><img loading="lazy" src="${escapeHtml(cast.input_src)}" alt="Input for ${escapeHtml(cast.title)}"></a></section>
      <section><h3>Output witnesses</h3><div class="witnesses">${cast.witnesses.map((witness) => `<a href="${escapeHtml(witness.src)}"><img loading="lazy" src="${escapeHtml(witness.src)}" alt="${escapeHtml(witness.label)}"><span>${escapeHtml(witness.label)}</span></a>`).join("")}</div></section>
      <section class="details"><h3>Effective settings</h3><dl>${settingOrder.map((key) => `<div><dt>${escapeHtml(key.replaceAll("_", " "))}</dt><dd>${escapeHtml(cast.settings[key])}</dd></div>`).join("")}</dl><div class="actions"><a href="${escapeHtml(cast.viewer_url)}" target="_blank" rel="noreferrer">Open in KamiNOS</a></div><h3>Blender GLB path</h3><div class="path"><code>${escapeHtml(cast.glb_path)}</code><button data-copy="${escapeHtml(cast.glb_path)}" title="Copy Blender path">Copy</button></div><h3>Claim ceiling</h3><p class="claim">${escapeHtml(cast.claim_ceiling)}</p></section>
    </div>
  </article>`).join("");

const css = `
:root{color-scheme:dark;--bg:#11110f;--panel:#1b1b18;--ink:#f1ede5;--muted:#aaa59c;--line:#3a3831;--accent:#f0a35b;--teal:#55b8aa}*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}a{color:inherit;text-decoration:none}.top{position:sticky;z-index:10;top:0;display:flex;align-items:center;gap:12px;padding:11px 18px;background:rgba(17,17,15,.96);border-bottom:1px solid var(--line)}.top h1{margin:0;font-size:20px}.top p{margin:2px 0 0;color:var(--muted);font-size:12px}.nav{display:flex;gap:7px}.nav a,.actions a,.path button{border:1px solid var(--line);border-radius:5px;background:#24231f;padding:8px 10px}.nav a:hover,.actions a:hover,.path button:hover{border-color:var(--accent)}input{width:min(330px,34vw);height:36px;margin-left:auto;border:1px solid var(--line);border-radius:5px;background:#090908;color:var(--ink);padding:0 10px}.content{width:min(1780px,calc(100% - 28px));margin:18px auto 48px}.list{display:grid;gap:14px}.cast{border:1px solid var(--line);border-radius:7px;overflow:hidden;background:var(--panel)}.cast>header{padding:11px 13px;border-bottom:1px solid var(--line)}h2{margin:0;font-size:16px}.cast header p{margin:2px 0 0;color:var(--muted);font-size:12px}.body{display:grid;grid-template-columns:minmax(180px,250px) minmax(340px,1fr) minmax(300px,430px);gap:13px;padding:13px}.body section{min-width:0}h3{margin:0 0 7px;color:var(--muted);font-size:11px;text-transform:uppercase}.source{display:block;aspect-ratio:1;border:1px solid var(--line);border-radius:5px;overflow:hidden;background:#090908}.source img{width:100%;height:100%;object-fit:contain}.witnesses{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:7px}.witnesses a{border:1px solid var(--line);border-radius:5px;overflow:hidden;background:#090908}.witnesses img{display:block;width:100%;aspect-ratio:1.45;object-fit:contain}.witnesses span{display:block;padding:5px 7px;color:var(--muted);font-size:11px;border-top:1px solid var(--line)}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0 0 9px;border:1px solid var(--line);background:var(--line)}dl div{padding:6px 7px;background:#24231f}dt{color:var(--muted);font-size:10px}dd{margin:0;overflow-wrap:anywhere}.actions{display:flex;margin:9px 0 13px}.path{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}.path code{padding:7px;border:1px solid var(--line);border-radius:5px;background:#090908;font-size:10px;overflow-wrap:anywhere}.path button{color:var(--ink);cursor:pointer}.claim{margin:0;padding:8px;border-left:3px solid var(--teal);background:#151917;color:#d8d5ce}.empty{display:none;padding:50px;text-align:center;color:var(--muted)}@media(max-width:1100px){.body{grid-template-columns:minmax(180px,240px) 1fr}.details{grid-column:1/-1}}@media(max-width:680px){.top{flex-wrap:wrap}.top input{width:100%;margin:0}.body{grid-template-columns:1fr}.details{grid-column:auto}.witnesses{grid-template-columns:1fr}}
`;

const embeddedManifest = JSON.stringify(manifest).replaceAll("<", "\\u003c");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cross-Family TRELLIS Atlas</title><style>${css}</style></head><body><header class="top"><nav class="nav"><a href="index.html" title="Image browser">Images</a><a href="spatial.html" title="Skull casts">Skulls</a></nav><div><h1>Cross-Family TRELLIS Atlas</h1><p>${casts.length} casts / source, witness, settings, KamiNOS route, and Blender path on every row</p></div><input id="search" type="search" placeholder="Filter family, route, or role"></header><main class="content"><section class="list">${cards}</section><div class="empty" id="empty">No matching casts</div></main><script id="crossFamilyManifest" type="application/json">${embeddedManifest}</script><script>
const cards=[...document.querySelectorAll('.cast')],search=document.getElementById('search'),empty=document.getElementById('empty');search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();let shown=0;cards.forEach(card=>{const visible=!q||card.dataset.search.includes(q);card.style.display=visible?'':'none';if(visible)shown++});empty.style.display=shown?'none':'block'});document.addEventListener('click',async event=>{const button=event.target.closest('[data-copy]');if(!button)return;try{await navigator.clipboard.writeText(button.dataset.copy)}catch{const area=document.createElement('textarea');area.value=button.dataset.copy;document.body.append(area);area.select();document.execCommand('copy');area.remove()}const prior=button.textContent;button.textContent='Copied';setTimeout(()=>button.textContent=prior,900)});
</script></body></html>`;

fs.writeFileSync(path.join(browserDir, "cross-family-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(browserDir, "cross-family.html"), html);
console.log(`built cross-family TRELLIS atlas with ${casts.length} casts`);
