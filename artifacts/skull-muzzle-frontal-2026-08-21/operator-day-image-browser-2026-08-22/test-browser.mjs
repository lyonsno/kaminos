import fs from "node:fs";
import path from "node:path";

const browserDir = path.dirname(new URL(import.meta.url).pathname);
const artifactRoot = path.dirname(browserDir);
const manifestPath = path.join(browserDir, "manifest.json");
const indexPath = path.join(browserDir, "index.html");
const spatialPath = path.join(browserDir, "spatial.html");
const crossFamilyPath = path.join(browserDir, "cross-family.html");
const crossFamilyManifestPath = path.join(browserDir, "cross-family-manifest.json");

function walkImages(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === browserDir) return [];
      return walkImages(fullPath);
    }
    return /\.(png|jpe?g|webp)$/i.test(entry.name) ? [fullPath] : [];
  });
}

if (!fs.existsSync(manifestPath)) throw new Error("manifest.json is missing");
if (!fs.existsSync(indexPath)) throw new Error("index.html is missing");
if (!fs.existsSync(spatialPath)) throw new Error("spatial.html is missing");
if (!fs.existsSync(crossFamilyPath)) throw new Error("cross-family.html is missing");
if (!fs.existsSync(crossFamilyManifestPath)) throw new Error("cross-family-manifest.json is missing");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const actualImages = walkImages(artifactRoot);
const listedPaths = manifest.images.map((item) => item.artifact_path);

if (manifest.schema !== "kaminos.handy_candyman.operator_image_browser.v2") {
  throw new Error(`unexpected schema: ${manifest.schema}`);
}
if (!Array.isArray(manifest.casts) || manifest.casts.length === 0) {
  throw new Error("manifest has no canonical spatial casts");
}
if (listedPaths.length !== actualImages.length) {
  throw new Error(`manifest lists ${listedPaths.length} images; filesystem has ${actualImages.length}`);
}
if (new Set(listedPaths).size !== listedPaths.length) throw new Error("manifest contains duplicate image paths");

for (const item of manifest.images) {
  if (path.isAbsolute(item.artifact_path)) throw new Error(`absolute artifact path: ${item.artifact_path}`);
  if (!fs.existsSync(path.join(artifactRoot, item.artifact_path))) {
    throw new Error(`missing image: ${item.artifact_path}`);
  }
  if (!item.group_id || !item.kind || !item.label) throw new Error(`incomplete image record: ${item.artifact_path}`);
}

for (const group of manifest.groups) {
  const pagePath = path.join(browserDir, group.page);
  if (!fs.existsSync(pagePath)) throw new Error(`missing group page: ${group.page}`);
  const groupCount = manifest.images.filter((item) => item.group_id === group.id).length;
  if (groupCount !== group.image_count) {
    throw new Error(`${group.id} reports ${group.image_count} images; manifest contains ${groupCount}`);
  }
}

const index = fs.readFileSync(indexPath, "utf8");
const spatial = fs.readFileSync(spatialPath, "utf8");
const crossFamily = fs.readFileSync(crossFamilyPath, "utf8");
const crossFamilyManifest = JSON.parse(fs.readFileSync(crossFamilyManifestPath, "utf8"));
if (!index.includes(`data-total-images="${actualImages.length}"`)) {
  throw new Error("index does not expose the complete image count");
}
if (!index.includes("Operator Image Browser")) throw new Error("index title is missing");
if (!index.includes('href="spatial.html"')) throw new Error("index does not link the spatial cast atlas");
if (!spatial.includes('href="cross-family.html"')) throw new Error("spatial atlas does not link the cross-family comparison");

for (const cast of manifest.casts) {
  if (!path.isAbsolute(cast.glb_path) || !fs.existsSync(cast.glb_path)) {
    throw new Error(`cast has no copyable absolute GLB path: ${cast.id}`);
  }
  if (!cast.input_path || !path.isAbsolute(cast.input_path) || !fs.existsSync(cast.input_path)) {
    throw new Error(`cast has no extant input image: ${cast.id}`);
  }
  if (!cast.input_src || !cast.viewer_url) throw new Error(`cast has incomplete operator routes: ${cast.id}`);
  for (const setting of ["seed", "steps", "resolution", "texture_size"]) {
    if (cast.settings?.[setting] === undefined) throw new Error(`cast omits ${setting}: ${cast.id}`);
  }
  if (!Array.isArray(cast.witnesses)) throw new Error(`cast has no witness inventory: ${cast.id}`);
  if (!spatial.includes(cast.glb_path) || !spatial.includes(cast.viewer_url)) {
    throw new Error(`spatial page omits operator routes for ${cast.id}`);
  }
}

const highResolution = manifest.casts.filter((cast) => cast.assay === "trellis-high-resolution-assay-2026-08-22");
if (highResolution.length !== 4) throw new Error(`expected four high-resolution casts; found ${highResolution.length}`);
for (const cast of highResolution) {
  if (!cast.featured) throw new Error(`high-resolution cast is not featured: ${cast.id}`);
  if (cast.witnesses.length < 2) throw new Error(`high-resolution cast needs front and oblique inspected witnesses: ${cast.id}`);
}
if (!spatial.includes("Input")) throw new Error("spatial page does not label source images as Input");
if (!spatial.includes("Effective settings")) throw new Error("spatial page does not label effective settings");

if (crossFamilyManifest.schema !== "kaminos.handy_candyman.cross_family_trellis_atlas.v1") {
  throw new Error(`unexpected cross-family schema: ${crossFamilyManifest.schema}`);
}
const requiredControls = [
  "polygonal-cat-cycle2-mlx",
  "pixal9-mlx",
  "pixal9-trellis-mac",
  "gribble-corrected-mlx",
  "gribble-baseline-mlx",
  "gribble-trellis-mac",
];
for (const id of requiredControls) {
  const cast = crossFamilyManifest.casts.find((candidate) => candidate.id === id);
  if (!cast) throw new Error(`cross-family atlas omits ${id}`);
  if (!path.isAbsolute(cast.glb_path) || !fs.existsSync(cast.glb_path)) {
    throw new Error(`cross-family cast has no extant Blender path: ${id}`);
  }
  if (!cast.input_src || !fs.existsSync(path.join(browserDir, cast.input_src))) {
    throw new Error(`cross-family cast has no local input image: ${id}`);
  }
  if (!cast.viewer_url || !cast.viewer_url.includes("mesh_path=")) {
    throw new Error(`cross-family cast has no exact KamiNOS route: ${id}`);
  }
  for (const setting of ["backend", "seed", "steps", "resolution", "cascade"]) {
    if (cast.settings?.[setting] === undefined) throw new Error(`cross-family cast omits ${setting}: ${id}`);
  }
  if (!cast.claim_ceiling) throw new Error(`cross-family cast omits its claim ceiling: ${id}`);
  if (!Array.isArray(cast.witnesses) || cast.witnesses.length === 0) {
    throw new Error(`cross-family cast has no visual witness: ${id}`);
  }
  for (const witness of cast.witnesses) {
    if (!fs.existsSync(path.join(browserDir, witness.src))) throw new Error(`missing local witness for ${id}: ${witness.src}`);
  }
  if (!crossFamily.includes(cast.glb_path) || !crossFamily.includes(cast.viewer_url)) {
    throw new Error(`cross-family page omits operator routes for ${id}`);
  }
}
for (const label of ["Input", "Effective settings", "Blender GLB path", "Open in KamiNOS", "Claim ceiling"]) {
  if (!crossFamily.includes(label)) throw new Error(`cross-family page omits label: ${label}`);
}

console.log(`browser contract passed: ${actualImages.length} images, ${manifest.casts.length} casts, ${manifest.groups.length} groups`);
