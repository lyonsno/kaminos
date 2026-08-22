import fs from "node:fs";
import path from "node:path";

const browserDir = path.dirname(new URL(import.meta.url).pathname);
const artifactRoot = path.dirname(browserDir);
const manifestPath = path.join(browserDir, "manifest.json");
const indexPath = path.join(browserDir, "index.html");

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

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const actualImages = walkImages(artifactRoot);
const listedPaths = manifest.images.map((item) => item.artifact_path);

if (manifest.schema !== "kaminos.handy_candyman.operator_image_browser.v1") {
  throw new Error(`unexpected schema: ${manifest.schema}`);
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
if (!index.includes(`data-total-images="${actualImages.length}"`)) {
  throw new Error("index does not expose the complete image count");
}
if (!index.includes("Operator Image Browser")) throw new Error("index title is missing");

console.log(`browser contract passed: ${actualImages.length} images across ${manifest.groups.length} groups`);
