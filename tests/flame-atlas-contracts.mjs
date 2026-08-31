import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.env.KAMINOS_ROOT ?? path.resolve(import.meta.dirname, "..");
const atlasRoot = path.join(repoRoot, "docs", "flame-atlas");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function sha256(relativePath) {
  const bytes = fs.readFileSync(path.join(atlasRoot, relativePath));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("flame atlas media, public manifest, and README routes agree", () => {
  const manifest = JSON.parse(read("docs/flame-atlas/capture-manifest.json"));
  const html = read("docs/flame-atlas/index.html");
  const rootReadme = read("README.md");
  const atlasReadme = read("docs/flame-atlas/README.md");

  assert.equal(manifest.schema, "kaminos.live-combustion-atlas.v1");
  assert.equal(manifest.route.simulation_grid, 96);

  const motion = manifest.media.filter(({ path: mediaPath }) => mediaPath.endsWith(".mp4"));
  assert.equal(motion.length, 6);
  assert.equal(new Set(motion.map(({ role }) => role)).size, 6);

  for (const media of manifest.media) {
    assert.equal(sha256(media.path), media.sha256, `${media.path} must match its public hash`);
    assert.match(atlasReadme, new RegExp(media.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const media of motion) {
    assert.match(html, new RegExp(`src=["']${media.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
    const posterPath = media.path.replace(/\.mp4$/, ".png");
    assert.ok(fs.existsSync(path.join(atlasRoot, posterPath)), `${posterPath} must exist`);
    assert.match(html, new RegExp(`poster=["']${posterPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
  }

  assert.match(rootReadme, /docs\/flame-atlas\/assets\/live-webgpu-combustion\.gif/);
  assert.match(rootReadme, /\[Live Combustion Atlas\]\(docs\/flame-atlas\/\)/);
  assert.match(atlasReadme, /capture-manifest\.json/);
  assert.match(manifest.claim_boundary, /not a universal simulator-performance claim/);
});
