import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compositionRestoreUrl } from './scene-authoring.mjs';
import { verifyAuthoringServer } from './scene-authoring-witness-identity.mjs';
import { decodeScreenshotPngRgb } from './screenshot-png-rgb.mjs';
import { checkedRenderOutput, outputPixels } from './render-output.mjs';

export function visualWorkOutput({output = {}, reason = null} = {}) {
  const settings = checkedRenderOutput({width:640,height:480,quality:'preview',...output});
  const pixels = outputPixels(settings);
  const justification = typeof reason === 'string' ? reason.trim() : '';
  if (settings.kind === 'recording') throw Error('Visual-work observations use still output; use the recording flow for clips');
  if ((pixels.width > 640 || pixels.height > 480 || settings.quality !== 'preview') && !justification)
    throw Error('Expensive output requires an explicit reason');
  return {settings,pixels,reason:justification || null};
}

export function prepareVisualWorkScene(source, {reason = null} = {}) {
  const justification = typeof reason === 'string' ? reason.trim() : '';
  const simulation = Boolean(source.composition || source.localLiquid || source.objects?.some(object =>
    object.simulation || ['simulation-domain','flame-emitter','local-liquid-emitter'].includes(object.type)));
  if (simulation && !justification) throw Error('Authored simulation requires an explicit cost reason; preview output does not budget physics');
  if (justification) return {document:structuredClone(source),policy:{mode:'explicit',reason:justification,simulation}};
  const document = structuredClone(source);
  document.editorDisplay = {...document.editorDisplay,quality:'preview'};
  document.postprocessing = {...document.postprocessing,
    ao:{...document.postprocessing?.ao,enabled:false},
    dof:{...document.postprocessing?.dof,enabled:false},
    sceneGI:{...document.postprocessing?.sceneGI,mode:'gtao',view:'scene'}};
  document.capture = null;
  return {document,policy:{mode:'cheap',simulation:false,
    overrides:{quality:'preview',ao:false,dof:false,sceneGI:'gtao'}}};
}

export function assertCapturePixels({ width, height, channels, pixels }, capture) {
  assert.ok(width === capture.width && height === capture.height && pixels.length === width * height * channels,
    'Capture dimensions differ from PNG');
  let first, varying = false;
  for (let i = 0; i < pixels.length; i += channels) {
    if (channels === 4 && pixels[i + 3] === 0) continue;
    const color = pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2];
    if (first === undefined) first = color;
    else if (first !== color) { varying = true; break; }
  }
  assert.ok(varying, 'Capture is empty or uniform; inspect the rendered scene');
}

export function assertSavedResult(result, persisted, {workspace=null,owner=null}={}) {
  assert.ok(result?.ok === true && result.document && result.filename?.endsWith('.kaminos.json'),
    `Save failed: ${result?.error || 'missing document result'}`);
  assert.equal(result.url, compositionRestoreUrl(result.document.composition, result.filename, new URL(result.url).origin, workspace,owner), 'Save URL differs from saved document');
  assert.deepEqual(persisted, result.document, 'Persisted document differs from save result');
  return result;
}

export function assertMountedScene(document, actual, {authoredObjects=[],volume=null}={}) {
  for (const expected of document.objects || []) {
    let mounted = actual.find(item => item.id === expected.id);
    if(!mounted&&expected.type==='simulation-domain'){
      const domain=authoredObjects.find(item=>item.id===expected.id&&item.type==='simulation-domain');
      if(domain){
        assert.ok(volume?.active&&Number.isFinite(volume.ordinaryDomainScale)&&volume.ordinaryDomainScale>0
          &&volume.ordinaryDomainTranslation?.length===3&&volume.ordinaryDomainTranslation.every(Number.isFinite),'Live domain runtime is unavailable');
        const scale=volume.ordinaryDomainScale,[x,y,z]=volume.ordinaryDomainTranslation;
        const requestedGrid=expected.simulation?.settings?.['volume-resolution']?.value;
        if(requestedGrid!==undefined)assert.equal(volume.controls?.resolution,Number(requestedGrid),'Live domain grid differs from saved domain grid');
        mounted={...domain,transform:{position:[x,y+scale,z],rotation:[0,0,0],scale:[scale,scale,scale]}};
      }
    }
    assert.ok(mounted, `Mount missing object ${expected.id}`);
    for (const field of ['type', 'source']) assert.equal(mounted[field], expected[field], `Mount differs: ${expected.id}.${field}`);
    for (const field of ['position', 'rotation', 'scale']) {
      const a = mounted.transform?.[field], b = expected.transform?.[field];
      assert.ok(a?.length === 3 && b?.length === 3 && a.every((n, i) => Number.isFinite(n) && Math.abs(n - b[i]) < 1e-8), `Mount differs: ${expected.id}.${field}`);
    }
  }
  return actual;
}

// The caller supplies a Playwright page and feature operations. All edits and
// persistence still run through the mounted editor's normal public operations.
export async function visualWork({ page, origin, repoRoot, sceneStore, basinStore, sceneFile, workspace=null,owner=null, out, exercise, execution=null, signal }) {
  await fs.mkdir(out, { recursive: true });
  const report = { status: 'running', phase: 'identity', startedAt: new Date().toISOString(),
    requested: { origin, repoRoot, sceneStore, basinStore, sceneFile, workspace }, observations: [], errors: [] };
  const reportPath = path.join(out, 'report.json');
  let terminal=false, writes=Promise.resolve(), removeAbort=()=>{};
  const write = () => {
    if(terminal)return writes;
    const content=JSON.stringify(report,null,2);
    writes=writes.then(()=>fs.writeFile(reportPath,content));
    return writes;
  };
  const pageError = error => report.errors.push(error.message);
  page.on('pageerror', pageError);
  await write();
  const readScene = async filename => {
    signal?.throwIfAborted();
    const response = await fetch(new URL(`/api/read?root=scenes&path=${encodeURIComponent(filename)}`, origin), { cache: 'no-store', signal });
    if (!response.ok) throw Error(`Scene read failed: ${filename}, HTTP ${response.status}`);
    return response.json();
  };
  try {
    const run = async () => {
    signal?.throwIfAborted();
    const output = execution === null ? null : visualWorkOutput(execution);
    report.execution = output;
    report.serving = await verifyAuthoringServer({ origin, repoRoot, fetch:(url,options)=>fetch(url,{...options,signal}) });
    if (sceneStore) assert.equal(await fs.realpath(sceneStore), await fs.realpath(report.serving.sceneStore), 'Wrong scene store');
    if (basinStore) assert.equal(await fs.realpath(basinStore), await fs.realpath(report.serving.basinStore), 'Wrong basin store');
    const open = async filename => {
      signal?.throwIfAborted();
      report.phase = 'open'; await write();
      let document = await readScene(filename);
      if (output) {
        const prepared = prepareVisualWorkScene(document, output);
        const sourceFilename = filename;
        // Save through the normal scene store; preserve the caller's source file.
        const response = await fetch(new URL('/api/save-scene', origin), {method:'POST',signal,
          headers:{'Content-Type':'application/json'},body:JSON.stringify(prepared.document)});
        if (!response.ok) throw Error(`Execution scene save failed: HTTP ${response.status}`);
        const saved = await response.json();
        if (!saved.saved) throw Error('Execution scene save returned no filename');
        filename = saved.saved;
        document = await readScene(filename);
        assert.deepEqual(document, prepared.document, 'Execution scene differs from requested cost settings');
        (report.executionScenes ??= []).push({sourceFilename,filename,policy:prepared.policy});
        await write();
      }
      const url = compositionRestoreUrl(document.composition, filename, origin, workspace,owner);
      // Leaving the document explicitly also exercises fresh restoration when
      // only the scene hash would otherwise change.
      await page.goto('about:blank');
      signal?.throwIfAborted();
      await page.goto(url);
      await page.waitForFunction(() => {
        const failure = document.querySelector('#status.failed');
        const status = document.getElementById('info-bar')?.textContent || '';
        if (failure || /Scene load failed|Invalid scene|water host unavailable/i.test(status)) throw Error(failure?.textContent || status);
        return /^(Scene loaded|Volume scene loaded)/.test(status);
      });
      const mount = await page.evaluate(() => {
        const volume=window.__kaminosVolumePrototype?.debugState();
        return {objects:window.kaminosSceneObjectDebugState(),authoredObjects:window.kaminosSceneAuthoring?.read().objects,
          volume:volume?.active ? volume : {active:false}};
      });
      assertMountedScene(document, mount.objects, mount);report.mount=mount;
      if (output && !output.reason) {
        const display = await page.evaluate(() => window.kaminosViewportSettings.read());
        assert.equal(display.quality, 'preview', 'Cheap viewport quality was not applied');
      }
      assert.equal(new URL(page.url()).origin, new URL(origin).origin, 'Mount changed origin');
      const route = new URL(page.url());
      const effectiveScene = route.searchParams.get('scene') || new URLSearchParams(route.hash.slice(1)).get('scene');
      assert.equal(effectiveScene, filename, 'Mount changed scene');
      report.opened = { filename, requestedUrl: url, effectiveUrl: page.url() };
      assert.deepEqual(report.errors, [], 'Uncaught browser error');
      await write();
      return document;
    };
    const retain = async ({ name, capture = true, settle = async () => {}, observe = async () => null, owner: expectedOwner = owner }) => {
      signal?.throwIfAborted();
      assert.ok(/^[a-z0-9][a-z0-9_-]*$/i.test(name), 'Observation name must be a path-safe filename');
      report.phase = `observe:${name}`; await write();
      await settle(page);
      signal?.throwIfAborted();
      const effective = await observe(page);
      signal?.throwIfAborted();
      const rendered = capture && output ? await page.evaluate(settings => window.kaminosRenderOutput.capture(settings), output.settings) : null;
      signal?.throwIfAborted();
      const result = await page.evaluate(capture => capture
        ? window.captureComposition({ result: true }) : window.saveSceneAs({ result: true }), capture && !output);
      if (!result?.ok) throw Error(`Save failed: ${result?.error || 'no result'}`);
      const persisted = await readScene(result.filename);
      assertSavedResult(result, persisted, {workspace,owner:expectedOwner});
      assert.deepEqual(report.errors, [], 'Uncaught browser error');
      await fs.writeFile(path.join(out, `${name}.kaminos.json`), JSON.stringify(persisted, null, 2));
      if (capture) {
        const image = rendered?.dataUrl ?? persisted.capture?.image;
        assert.ok(image?.startsWith('data:image/png;base64,'), 'Capture missing PNG');
        if (output) {
          assert.equal(rendered.width, output.pixels.width, 'Wrong output width');
          assert.equal(rendered.height, output.pixels.height, 'Wrong output height');
          assert.deepEqual(rendered.settings, output.settings, 'Wrong output settings');
        }
        const png = Buffer.from(image.split(',')[1], 'base64');
        assertCapturePixels(decodeScreenshotPngRgb(png), rendered ?? persisted.capture);
        await fs.writeFile(path.join(out, `${name}.png`), png);
      }
      const {dataUrl, ...renderReceipt} = rendered ?? {};
      const observation = { name, filename: result.filename, url: result.url, captured: capture,
        effective, ...(rendered ? {rendering:renderReceipt,image:`${name}.png`,state:'authored-scene'} : {}), savedAt: new Date().toISOString() };
      report.observations.push(observation); await write();
      return result;
    };
    const document = await open(sceneFile);
    report.phase = 'exercise'; await write();
    report.result = await exercise({ page, document, open, retain, signal });
    signal?.throwIfAborted();
    assert.deepEqual(report.errors, [], 'Uncaught browser error');
    report.status = 'passed'; report.phase = 'complete';
    return report;
    };
    if(!signal)return await run();
    const cancelled=new Promise((_,reject)=>{
      const abort=()=>reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
      removeAbort=()=>signal.removeEventListener('abort',abort);
      if(signal.aborted)abort();
    });
    return await Promise.race([run(),cancelled]);
  } catch (error) {
    report.status = signal?.aborted ? 'cancelled' : 'failed'; report.failure = error.stack || String(error);
    try { if(!signal?.aborted)await page.screenshot({ path: path.join(out, 'failed.png') }); }
    catch (captureError) { report.failureCaptureError = String(captureError); }
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString(); const finalWrite=write();
    terminal=true;removeAbort(); await finalWrite;
    page.off('pageerror', pageError);
  }
}
