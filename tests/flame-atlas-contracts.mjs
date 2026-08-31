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

test("generated-worlds README and flame screening room public claims agree", () => {
  const manifest = JSON.parse(read("docs/flame-atlas/capture-manifest.json"));
  const html = read("docs/flame-atlas/index.html");
  const rootReadme = read("README.md");
  const atlasReadme = read("docs/flame-atlas/README.md");

  assert.equal(manifest.schema, "kaminos.live-combustion-screening-room.v2");
  assert.equal(manifest.route.simulation_grid, 96);

  const motion = manifest.media.filter(({ path: mediaPath }) => mediaPath.endsWith(".mp4"));
  const compositions = motion.filter(({ presentation }) => presentation === "composition");
  const studies = motion.filter(({ presentation }) => presentation === "study");
  assert.equal(motion.length, 10);
  assert.equal(compositions.length, 4);
  assert.equal(studies.length, 6);
  assert.equal(compositions.filter(({ primary }) => primary).length, 1);
  assert.equal(new Set(motion.map(({ role }) => role)).size, 10);

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
  assert.match(rootReadme, /\[Live Combustion\]\(docs\/flame-atlas\/\)/);
  assert.match(rootReadme, /^> A browser-native workbench for making generated worlds live\.$/m);
  assert.match(rootReadme, /\*\*Generated beings\*\*/);
  assert.match(rootReadme, /\*\*Live materials\*\*/);
  assert.match(rootReadme, /\*\*Browser-native intelligence\*\*/);
  assert.match(rootReadme, /\*\*A world kiln\*\*/);
  assert.match(rootReadme, /Generated creatures can preserve deliberate morphology\s+through generative transformation and return to mechanical control\./);
  assert.doesNotMatch(rootReadme, /Generated beings retain identity, structure, and handles after inference/i);
  assert.match(html, /<a href=["']\.\.\/\.\.\/["']>Kaminos<\/a>/);
  assert.doesNotMatch(html, /href=["']\.\.\/\.\.\/README\.md["']/);
  assert.match(atlasReadme, /capture-manifest\.json/);
  assert.match(manifest.claim_boundary, /no simulator frame-rate or quality-tier claim/i);

  const publicCopy = `${rootReadme}\n${atlasReadme}\n${html}`;
  assert.doesNotMatch(publicCopy, /hero settings/i);
  assert.doesNotMatch(publicCopy, /\b\d+(?:[-–]\d+)?\s*fps\b/i);
  assert.doesNotMatch(publicCopy, /\b(?:60|30|24|12)\s*\/\s*1\b/);
  assert.doesNotMatch(publicCopy, /\b(?:96|128|160)\s*(?:\^?3|³)\b/i);
  assert.match(publicCopy, /captured directly from the live browser runtime/i);
  assert.doesNotMatch(html, /<video\b[^>]*\sautoplay(?:\s|>)/i);
});
