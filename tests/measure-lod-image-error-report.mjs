// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {measure} from '../tools/measure-lod-image-error.mjs';

const hero = 'a'.repeat(64), l1 = 'b'.repeat(64), l2 = 'c'.repeat(64), retired = 'd'.repeat(64);
const standIn = () => new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/mesh-lods' && url.searchParams.get('source') === hero) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({levels: [{sha256: l1, faces: 5000}, {sha256: l2, faces: 500}], retired: [{sha256: retired, faces: 1000}]}));
    }
    res.statusCode = 404; res.end('{}');
  });
  server.listen(0, '127.0.0.1', () => resolve({server, url: `http://127.0.0.1:${server.address().port}`}));
});
const goodResult = (url, overrides = {}) => { const q = new URL(url).searchParams;
  return {schema: 'kaminos.lod-image-error.v1', reference: {sha256: q.get('ref')}, level: {sha256: q.get('level')}, route: {glRenderer: 'test'},
    settings: {resolution: +q.get('res'), views: 2}, perView: [{}, {}], aggregate: {normalP95Degrees: {mean: 10}}, ...overrides}; };
const fakeBrowser = (page, calls) => async () => ({executable: '/fake', version: 'Fake/1', closed: false,
  openPage: async url => { calls.push(url); return page(url); }, close: async () => { calls.push('closed'); }});
const setup = async () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-image-error-')), s = await standIn();
  return {dir, s, args: {server: s.url, source: hero, out: path.join(dir, 'out'), report: path.join(dir, 'report.json')}}; };
const saved = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('measures every current level, writing each result and sheet, and never a retired one', async () => {
  const {s, args} = await setup(), calls = [];
  try {
    const report = await measure(args, {browserFor: fakeBrowser(url => ({title: 'done', result: goodResult(url), png: Buffer.from('png')}), calls)});
    assert.equal(report.phase, 'done', report.error?.message);
    assert.deepEqual(report.levels.map(l => l.sha256), [l1, l2]);
    assert.ok(!calls.some(c => c.includes(retired)));
    assert.equal(calls.at(-1), 'closed');
    assert.equal(saved(path.join(args.out, `${l2}.image-error.json`)).level.sha256, l2);
    assert.equal(fs.readFileSync(path.join(args.out, `${l1}.image-error.png`), 'utf8'), 'png');
    assert.equal(saved(args.report).browser.version, 'Fake/1');
  } finally { s.server.close(); }
});

test('a retired or unknown level is refused before any browser starts', async () => {
  const {s, args} = await setup(); let launched = false;
  try {
    const report = await measure({...args, levels: retired}, {browserFor: async () => { launched = true; }});
    assert.equal(report.phase, 'levels'); assert.match(report.error.message, /not a current level/); assert.equal(launched, false);
  } finally { s.server.close(); }
});

test('a page that errors ends the run with its message and the browser closed', async () => {
  const {s, args} = await setup(), calls = [];
  try {
    const report = await measure(args, {browserFor: fakeBrowser(() => ({title: 'error', error: 'reference covers no pixel in any view', result: null}), calls)});
    assert.equal(report.phase, 'measure'); assert.match(report.error.message, /covers no pixel/);
    assert.equal(saved(args.report).levels[0].title, 'error'); assert.equal(calls.at(-1), 'closed');
  } finally { s.server.close(); }
});

test('a result describing another pair or other settings is refused, and nothing is written for it', async () => {
  const {s, args} = await setup();
  try {
    for (const bad of [{level: {sha256: hero}}, {settings: {resolution: 256, views: 2}}, {perView: [{}]}, {schema: 'kaminos.lod-image-error.scratch'}]) {
      const report = await measure(args, {browserFor: fakeBrowser(url => ({title: 'done', result: goodResult(url, bad), png: Buffer.from('png')}), [])});
      assert.equal(report.phase, 'measure', JSON.stringify(bad)); assert.match(report.error.message, /does not describe/);
      assert.ok(!fs.existsSync(path.join(args.out, `${l1}.image-error.json`)));
    }
    const blank = await measure(args, {browserFor: fakeBrowser(url => ({title: 'done', result: goodResult(url), png: null}), [])});
    assert.match(blank.error.message, /no sheet/);
  } finally { s.server.close(); }
});

test('missing arguments still leave a failure report', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-image-error-')), reportPath = path.join(dir, 'r.json');
  const report = await measure({server: 'http://127.0.0.1:9', source: 'nothex', out: dir, report: reportPath});
  assert.equal(report.phase, 'admission'); assert.ok(saved(reportPath).finishedAt);
  process.exitCode = 0;
});
