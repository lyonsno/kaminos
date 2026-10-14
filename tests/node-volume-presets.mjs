// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createKaminosAppHost} from '../node-app-host.mjs';
import {validateVolumeSettingsPresetIndex,validateVolumeSettingsPresetDocument} from '../volume-settings-preset-contract.mjs';
const schema={identity:'kaminos-volume-settings-preset-schema-v2',controlCount:3,
 controls:[{key:'volume-strength',param:'volume_strength',tagName:'INPUT',type:'range'},
 {key:'volume-visible',param:'volume_visible',tagName:'INPUT',type:'checkbox'},
 {key:'volume-density',param:'volume_density',tagName:'INPUT',type:'range',additiveDefault:'2.5'}],
 rendererControls:[],presentationControls:[],retiredControls:[],excludedStateFields:[],forbiddenPresetFields:[],
 allowedNativePresetFields:['identity','kind','schemaIdentity','controlCount','domControls','rendererControls','rendererControlCount','presentationControls','presentationControlCount','stateExclusions','route'],
 activationParam:{key:'native_volume',value:'1'},routeExtraParams:[]};
const sha=s=>createHash('sha256').update(s).digest('hex');
async function fixture(t){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'kaminos-node-basins-'))),repoRoot=join(dir,'repo'),stateRoot=join(dir,'state'),volumeSettingsStore=join(dir,'local'),sharedBasinStore=join(dir,'shared');
 for(const p of [repoRoot,volumeSettingsStore,sharedBasinStore])await mkdir(p);
 await writeFile(join(repoRoot,'volume-settings-preset-schema-v2.json'),JSON.stringify(schema));
 const host=await createKaminosAppHost({repoRoot,stateRoot,volumeSettingsStore,sharedBasinStore});await host.listen(0,'127.0.0.1');
 t.after(async()=>{await host.close();await rm(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${host.server.address().port}`;
 const request=async path=>{const response=await fetch(url+path);return{status:response.status,body:await response.json()};};
 async function put(store,{alias='kiln-look',label='The authored kiln look',number='1.25',canonicalNumber=number,routeNumber=canonicalNumber,stamp='2026-10-01T00:00:00Z',publish=true}={}){
  // This fixture specifies stored canonical bytes independently of the Node
  // reader; preserving a Python float token 1.0 is a concrete hash invariant.
  const canonical=`{"controls":{"volume-strength":${canonicalNumber},"volume-visible":true},"schemaIdentity":"${schema.identity}"}`;
  const presetId='vsp-'+sha(canonical),contentHash='sha256:'+presetId.slice(4);
  const preset={identity:'kaminos-volume-settings-preset-v2',kind:'settings-preset',schemaIdentity:schema.identity,controlCount:2,
   domControls:{'volume-strength':{id:'volume-strength',param:'volume_strength',tagName:'INPUT',type:'range',value:'NUMBER_TOKEN'},
    'volume-visible':{id:'volume-visible',param:'volume_visible',tagName:'INPUT',type:'checkbox',value:true}},stateExclusions:{},
   route:`/?native_volume=1&volume_strength=${encodeURIComponent(routeNumber)}&volume_visible=true`};
  const document={identity:'kaminos-volume-settings-preset-artifact-v2',presetId,contentHash,schemaIdentity:schema.identity,controlCount:2,initialLabel:label,writtenAt:stamp,source:{fixture:'local-policy'},preset};
  await mkdir(join(store,'presets'),{recursive:true});const path=join(store,'presets',presetId+'.json');
  const bytes=JSON.stringify(document).replace('"NUMBER_TOKEN"',number);await writeFile(path,bytes);
  const pointer={identity:'kaminos-volume-settings-preset-alias-v1',alias,label,presetId,contentHash,schemaIdentity:schema.identity,updatedAt:stamp,source:{fixture:'local-policy'}};
  if(publish){await mkdir(join(store,'aliases'),{recursive:true});await writeFile(join(store,'aliases',alias+'.json'),JSON.stringify(pointer));}
  return{presetId,contentHash,alias,pointer,path,bytes,document};
 }
 return{dir,repoRoot,stateRoot,volumeSettingsStore,sharedBasinStore,host,url,request,put};
}

test('Node reads actual named preset storage, preserves identity and projects schema-owned additive controls',async t=>{
 const f=await fixture(t),value=await f.put(f.sharedBasinStore);const index=await f.request('/api/volume-settings-presets');
 assert.equal(index.status,200);assert.equal(validateVolumeSettingsPresetIndex(index.body),true);assert.equal(index.body.entries.length,1);
 const entry=index.body.entries[0];assert.equal(entry.presetId,value.presetId);assert.equal(entry.label,value.pointer.label);assert.equal(entry.storeRole,'shared');assert.deepEqual(entry.defaultsApplied,['volume-density']);
 const result=await f.request('/api/volume-settings-preset?id=kiln-look');assert.equal(result.status,200);assert.equal(result.body.sourceControlCount,2);assert.equal(result.body.controlCount,3);assert.equal(result.body.contentHash,value.contentHash);
 const accepted=validateVolumeSettingsPresetDocument(result.body,'kiln-look',schema);assert.equal(accepted.preset.domControls['volume-density'].value,'2.5');
 assert.equal(await readFile(value.path,'utf8'),value.bytes,'read/projection must not rewrite the stored source');
 const config=(await f.request('/api/runtime-config')).body;assert.equal(config.volumeSettingsStore,f.volumeSettingsStore);assert.equal(config.sharedBasinStore,f.sharedBasinStore);
});

test('stored Python float spelling participates in immutable content verification',async t=>{
 const f=await fixture(t),value=await f.put(f.volumeSettingsStore,{number:'1.0'});
 const result=await f.request('/api/volume-settings-preset?id='+value.presetId);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.presetId,value.presetId);
 await writeFile(value.path,value.bytes.replace('"value":1.0','"value":1.1'));
 const bad=await f.request('/api/volume-settings-preset?id='+value.presetId);assert.equal(bad.status,400);assert.match(bad.body.error,/content hash/);
 const index=await f.request('/api/volume-settings-presets');assert.equal(index.status,200);assert.equal(index.body.entries.length,0);assert.equal(index.body.unavailableEntries[0].presetId,value.presetId);
});

test('a historical alias spelled as a content ID retains direct artifact read semantics',async t=>{
 const f=await fixture(t),value=await f.put(f.sharedBasinStore,{publish:false,label:'Original authored artifact'});
 await mkdir(join(f.sharedBasinStore,'aliases'));
 await writeFile(join(f.sharedBasinStore,'aliases',value.presetId+'.json'),JSON.stringify({...value.pointer,alias:value.presetId,label:'Historical pointer name'}));
 const index=await f.request('/api/volume-settings-presets');assert.equal(index.status,200);assert.equal(index.body.entries[0].label,'Original authored artifact');
 const read=await f.request('/api/volume-settings-preset?id='+value.presetId);assert.equal(read.body.alias,null);assert.equal(read.body.label,'Original authored artifact');
});

test('equivalent JSON float spellings keep the Python value identity and exponent convention',async t=>{
 const f=await fixture(t);
 for(const [number,canonicalNumber]of [['1.00','1.0'],['1E-5','1e-05'],['1.0E16','1e+16']]){
  const value=await f.put(f.volumeSettingsStore,{number,canonicalNumber,publish:false});
  const result=await f.request('/api/volume-settings-preset?id='+value.presetId);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.presetId,value.presetId);
 }
});

test('an unreadable shared current label remains unavailable instead of being replaced by a readable local label',async t=>{
 const f=await fixture(t),local=await f.put(f.volumeSettingsStore,{number:'1.25'}),shared=await f.put(f.sharedBasinStore,{number:'2.5'});
 await rm(shared.path);
 const index=await f.request('/api/volume-settings-presets');assert.equal(index.status,200);assert.equal(index.body.entries.length,0);
 assert.equal(index.body.unavailableEntries[0].presetId,shared.presetId);assert.equal(index.body.unavailableEntries[0].storeRole,'shared');
 assert.equal(index.body.earlierVersions[0].presetId,local.presetId);assert.equal(index.body.earlierVersions[0].reason,'other-store-label');
 assert.equal((await f.request('/api/volume-settings-preset?id=kiln-look')).status,404);
 assert.equal((await f.request('/api/volume-settings-preset?id='+local.presetId)).status,200);
});

test('earlier label versions and invalid rows remain visible without breaking the complete index',async t=>{
 const f=await fixture(t),older=await f.put(f.sharedBasinStore,{number:'1.25'}),current=await f.put(f.sharedBasinStore,{number:'2.5',stamp:'2026-10-02T00:00:00Z'});
 await mkdir(join(f.sharedBasinStore,'alias-history'));
 await writeFile(join(f.sharedBasinStore,'alias-history','kiln-look.jsonl'),JSON.stringify({...older.pointer,publishedAt:older.pointer.updatedAt})+'\nnot json\n'+JSON.stringify({...current.pointer,publishedAt:current.pointer.updatedAt})+'\n');
 await writeFile(join(f.sharedBasinStore,'aliases','bad.json'),'{broken');
 const index=await f.request('/api/volume-settings-presets');assert.equal(index.status,200);assert.equal(index.body.entries[0].presetId,current.presetId);assert.equal(index.body.earlierVersions[0].presetId,older.presetId);
 assert.equal(index.body.invalidAliases.length,1);assert.equal(index.body.invalidHistoryRows[0].line,2);
});

test('a foreign inventory is reported as schema skew while corruption remains a damaged artifact',async t=>{
 const f=await fixture(t),value=await f.put(f.sharedBasinStore);
 await writeFile(value.path,value.bytes.replace('"param":"volume_strength"','"param":"different_strength"'));
 const index=await f.request('/api/volume-settings-presets');assert.equal(index.status,200);assert.equal(index.body.entries.length,0);
 assert.equal(index.body.unavailableEntries[0].reason,'schema-skew');assert.equal(index.body.unavailableEntries[0].presetId,value.presetId);
});

test('a caller-selected missing store fails visibly and a new private default is truly empty',async t=>{
 const f=await fixture(t);await rm(f.sharedBasinStore,{recursive:true});
 const missing=await f.request('/api/volume-settings-presets');assert.equal(missing.status,500);assert.equal(missing.body.failurePhase,'shared-preset-index');assert.equal(missing.body.stores[1].storePath,f.sharedBasinStore);
 const privateHost=await createKaminosAppHost({repoRoot:f.repoRoot,stateRoot:join(f.dir,'private-state')});await privateHost.listen(0,'127.0.0.1');t.after(()=>privateHost.close());
 const url=`http://127.0.0.1:${privateHost.server.address().port}`,response=await fetch(url+'/api/volume-settings-presets'),index=await response.json();assert.equal(response.status,200);assert.deepEqual(index.entries,[]);assert.equal(index.stores.length,1);assert.equal(index.stores[0].role,'local');
 const config=await(await fetch(url+'/api/runtime-config')).json();assert.equal(config.sharedBasinStore,null);assert.equal(config.volumeSettingsStore,join(f.dir,'private-state','volume-settings'));
});

test('read routes refuse unsafe references and escaping artifacts; no preset write is implicitly claimed',async t=>{
 const f=await fixture(t),value=await f.put(f.sharedBasinStore);const outside=join(f.dir,'outside.json');await writeFile(outside,value.bytes);await rm(value.path);await symlink(outside,value.path);
 assert.equal((await f.request('/api/volume-settings-preset?id='+value.presetId)).status,400);
 assert.equal((await f.request('/api/volume-settings-preset?id=../outside')).status,400);
 const post=await fetch(f.url+'/api/volume-settings-presets',{method:'POST',body:'{}'});assert.equal(post.status,501);
});
