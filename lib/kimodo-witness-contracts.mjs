import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const ELFINBLUE_PRESET='vsp-6209fc3bc3c625da302e6f01c23a8687c40c0c4575f774df1f28b036e173586b';
export const PRESET_AUTHORITY='shared-volume-settings-preset-v2';
export function verifyIdentity({expected,effective,resources,weightsHash,url,expectedHostCommit,expectedProducerCommit}) {
  assert.ok(expectedHostCommit&&expectedProducerCommit,'caller revision pins required');
  assert.equal(expected.hostCommit,expectedHostCommit,'wrong caller-pinned host');
  assert.equal(expected.sourceCommit,expectedProducerCommit,'wrong caller-pinned producer');
  assert.equal(effective.status,'built','incomplete build');
  assert.equal(effective.sourceCommit,expected.sourceCommit,'wrong producer commit');
  assert.equal(effective.hostCommit,expected.hostCommit,'wrong host build');
  const route=new URL(url);
  assert.equal(route.searchParams.get('settings_preset'),ELFINBLUE_PRESET,'wrong preset');
  assert.equal(route.searchParams.get('settings_preset_authority'),PRESET_AUTHORITY,'wrong preset authority');
  assert.equal(new URLSearchParams(route.hash.slice(1)).get('composition_module_url'),'./kimodo-live-flame-inject.mjs','wrong composition module');
  assert.equal(weightsHash,expected.assets['kimodo.bin'].sha256,'wrong consumed weights');
  for(const name of Object.keys(expected.assets))assert.equal(effective.assets?.[name]?.sha256,expected.assets[name].sha256,`wrong asset manifest: ${name}`);
  for(const [name,hash] of Object.entries(expected.bundles))assert.equal(effective.bundles?.[name],hash,`wrong bundle manifest: ${name}`);
  for(const resource of resources){
    assert.ok(!resource.error&&typeof resource.sha256==='string'&&typeof resource.expectedSha256==='string',`missing served content: ${resource.path}`);
    assert.equal(resource.sha256,resource.expectedSha256,`wrong served content: ${resource.path}`);
  }
  for(const name of Object.keys(expected.assets).filter(n=>n!=='kimodo.bin'))
    assert.ok(resources.some(r=>r.path===`artifacts/kimodo-live-flame/assets/${name}`&&r.sha256===expected.assets[name].sha256),`missing/wrong consumed asset: ${name}`);
  for(const [name,hash] of Object.entries(expected.bundles))
    assert.ok(resources.some(r=>r.path===`artifacts/kimodo-live-flame/lib/${name}`&&r.sha256===hash),`missing/wrong loaded bundle: ${name}`);
  for(const name of ['index.html','kimodo-live-flame-inject.mjs','volume-core.js'])assert.ok(resources.some(r=>r.path===name&&r.sha256===r.expectedSha256),`missing served host: ${name}`);
  return {status:'verified',sourceCommit:effective.sourceCommit,hostCommit:effective.hostCommit,preset:ELFINBLUE_PRESET};
}
export function verifyMotion(bytes,run) {
  const m=JSON.parse(bytes.toString());
  assert.equal(m.generationId,run.generationId,'wrong motion generation');
  assert.equal(m.prompt,run.prompt,'wrong motion prompt');
  for(const k of ['numFrames','numJoints','fps'])assert.equal(m[k],run.motion[k],`wrong motion ${k}`);
  assert.equal(m.parents.length,m.numJoints);
  assert.ok(m.parents.every((p,i)=>Number.isInteger(p)&&p>=-1&&p<i),'invalid joint parents');
  for(const [key,role,width] of [['joints','soma-joints',m.numJoints],['motion','motion-clip',369]]){
    const rows=m[key];assert.equal(rows.length,m.numFrames);
    assert.ok(rows.every(r=>Array.isArray(r)&&r.length===width),'wrong frame width');
    if(key==='joints')assert.ok(rows.every(r=>r.every(j=>Array.isArray(j)&&j.length===3)),'wrong joint coordinates');
    const values=rows.flat(key==='joints'?2:1);assert.ok(values.every(Number.isFinite),'nonfinite motion');
    const observed=run.receipt.outputs.find(o=>o.role===role);
    assert.equal(observed?.status,'real');
    assert.equal(sha256(Buffer.from(new Float32Array(values).buffer)),observed.sha256,'export differs from terminal receipt');
  }
  return {status:'verified',generationId:m.generationId,numFrames:m.numFrames,numJoints:m.numJoints,sha256:sha256(bytes)};
}
