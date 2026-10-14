import {readFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validatePresetSchema} from './volume-settings-preset-contract.mjs';

const identity='kaminos-volume-settings-preset-schema-v2';
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isId=v=>typeof v==='string'&&/^vsp-[a-f0-9]{64}$/.test(v);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const value=d=>Object.hasOwn(d,'rawValue')?d.rawValue:d.value;
const error=(message,code)=>Object.assign(new Error(message),{code});
class SchemaSkew extends Error {}
function pythonNumber(text) {
 if(!/[.eE]/.test(text))return text==='-0'?'0':text;
 const number=Number(text);if(!Number.isFinite(number))throw error('non-finite stored preset number');
 if(number===0)return Object.is(number,-0)?'-0.0':'0.0';
 const magnitude=Math.abs(number);
 if(magnitude<1e-4||magnitude>=1e16){
  const [mantissa,exponent]=number.toExponential().split('e'),e=Number(exponent);
  return mantissa+'e'+(e<0?'-':'+')+String(Math.abs(e)).padStart(2,'0');
 }
 const fixed=String(number);return fixed.includes('.')?fixed:fixed+'.0';
}
class NumberToken {constructor(text){this.text=pythonNumber(text);}}
// Keep the integer/float distinction and Python's numeric representation.
// Parsing 1.0 as a JS number and serializing it as 1 changes a basin's ID;
// equivalent float JSON spellings such as 1.00 still canonicalize to 1.0.
// The replacement marker cannot occur in the original document; only numeric
// tokens outside quoted JSON strings are replaced in the auxiliary hash tree.
function parseStored(text) {
 const plain=JSON.parse(text);let prefix;
 do{prefix='__kaminos_number_'+randomUUID()+'_';}while(text.includes(prefix));
 const numbers=new Map();
 const auxiliary=text.replace(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,(token,number)=>{
  if(number===undefined)return token;const marker=prefix+numbers.size;numbers.set(marker,number);return JSON.stringify(marker);
 });
 const tokens=JSON.parse(auxiliary,(key,v)=>typeof v==='string'&&numbers.has(v)?new NumberToken(numbers.get(v)):v);
 return{plain,tokens};
}
const codepointOrder=(a,b)=>{
 const left=Array.from(a),right=Array.from(b);
 for(let i=0;i<Math.min(left.length,right.length);i++){const difference=left[i].codePointAt(0)-right[i].codePointAt(0);if(difference)return difference;}
 return left.length-right.length;
};
const asciiJSON=v=>JSON.stringify(v).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
function canonical(v) {
 if(v instanceof NumberToken)return v.text;
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(isObject(v))return '{'+Object.keys(v).sort(codepointOrder).map(k=>asciiJSON(k)+':'+canonical(v[k])).join(',')+'}';
 return asciiJSON(v);
}
function contentHash(tokens) {
 const values=controls=>Object.fromEntries(Object.entries(controls||{}).map(([key,descriptor])=>[key,value(descriptor)]));
 const record={schemaIdentity:identity,controls:values(tokens.domControls)};
 for(const group of ['rendererControls','presentationControls'])if(Object.keys(tokens[group]||{}).length)record[group]=values(tokens[group]);
 return sha(canonical(record));
}
const routeValue=v=>v instanceof NumberToken?v.text:v===null?'':String(v);
const defaultDescriptor=d=>({id:d.key,param:d.param,tagName:d.tagName,type:d.type,value:d.additiveDefault});
function descriptor(key,d,expected,{allowUnsupported=false,inventorySkew=false}={}) {
 if(!isObject(d)||d.id!==key)throw error('settings preset control descriptor id mismatch for '+key);
 if(d.param!==expected.param||String(d.tagName||'').toUpperCase()!==String(expected.tagName||'').toUpperCase()||String(d.type||'').toLowerCase()!==String(expected.type||'').toLowerCase())throw new (inventorySkew?SchemaSkew:Error)('settings preset control inventory mismatch for '+key);
 if(['value','rawValue'].filter(k=>Object.hasOwn(d,k)).length!==1)throw error('settings preset control stored value is invalid for '+key);
 const v=value(d),type=expected.type.toLowerCase();
 const decimal=typeof v==='string'?v.trim().replace(/(?<=\d)_(?=\d)/g,''):null;
 const numeric=typeof v==='number'?Number.isFinite(v):typeof v==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(decimal)&&Number.isFinite(Number(decimal));
 if(type==='range'&&!numeric||type==='checkbox'&&typeof v!=='boolean'||['color','text','select-one','button-state'].includes(type)&&typeof v!=='string')throw error('settings preset control stored value type mismatch for '+key);
 if(!allowUnsupported&&expected.allowedValues&&!expected.allowedValues.includes(v))throw error('settings preset control has unsupported value for '+key);
}
const encodeQuery=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g,'+');
function project(input,tokens,schema,schemaTokens) {
 if(!isObject(input)||input.identity!=='kaminos-volume-settings-preset-v2'||input.kind!=='settings-preset'||input.schemaIdentity!==schema.identity)throw error('settings preset identity/schema mismatch');
 const unexpected=Object.keys(input).filter(key=>!schema.allowedNativePresetFields.includes(key));
 if(unexpected.length)throw new SchemaSkew('settings preset contains fields outside its canonical schema: '+unexpected.join(','));
 const normalized=structuredClone(input),defaults=[],retired=[],carried=[],replaced=[],routed=new Map(),remove=new Set(),replace=new Map(),add=new Map();
 const params=new Set(['controls','rendererControls','presentationControls','retiredControls'].flatMap(group=>(schema[group]||[]).map(d=>d.param)));
 for(const [field,count,group,defaultMissing,axis]of [['domControls','controlCount','controls',true,'basin'],['rendererControls','rendererControlCount','rendererControls',false,'renderer'],['presentationControls','presentationControlCount','presentationControls',true,'presentation']]){
  const authored=input[field]!==undefined&&input[field]!==null,controls=structuredClone(input[field]??{}),expected=schema[group]||[],byKey=new Map(expected.map(d=>[d.key,d])),rawByKey=new Map((schemaTokens[group]||[]).map(d=>[d.key,d]));
  if(!isObject(controls)||input[count]!=null&&input[count]!==Object.keys(controls).length)throw error('settings preset '+count+' does not match its authored inventory');
  const retiredByKey=new Map((schema.retiredControls||[]).filter(d=>d.axis===field).map(d=>[d.key,d]));
  for(const key of Object.keys(controls).sort(codepointOrder))if(!byKey.has(key)&&!retiredByKey.has(key)){
   const d=controls[key];if(!isObject(d)||d.id!==key||typeof d.param!=='string'||!d.param||['value','rawValue'].filter(k=>Object.hasOwn(d,k)).length!==1)throw error('settings preset control descriptor is invalid: '+key);
   if(params.has(d.param)||routed.has(d.param))throw new SchemaSkew('settings preset carried control reuses parameter '+d.param);
   routed.set(d.param,routeValue(value(tokens[field][key])));remove.add(d.param);carried.push({axis,id:key,param:d.param,value:value(d)});delete controls[key];
  }
  for(const key of Object.keys(controls).sort(codepointOrder))if(retiredByKey.has(key)){
   const d=controls[key],expected=retiredByKey.get(key);descriptor(key,d,expected);routed.set(expected.param,routeValue(value(tokens[field][key])));remove.add(expected.param);retired.push({axis,id:key,param:expected.param,value:value(d)});delete controls[key];
  }
  for(const [key,d]of Object.entries(controls)){
   const expected=byKey.get(key),v=value(d);descriptor(key,d,expected,{allowUnsupported:true,inventorySkew:true});
   routed.set(expected.param,routeValue(value(tokens[field][key])));
   if(expected.allowedValues&&!expected.allowedValues.includes(v)){
    if(!Object.hasOwn(expected,'additiveDefault'))throw new SchemaSkew('settings preset value not offered by this schema: '+key);
    controls[key]=defaultDescriptor(expected);replace.set(expected.param,routeValue(rawByKey.get(key).additiveDefault));replaced.push({axis,id:key,param:expected.param,value:v,effective:expected.additiveDefault});
   }
  }
  const missing=expected.filter(d=>!Object.hasOwn(controls,d.key));
  if(missing.length&&!authored&&!defaultMissing&&!missing.every(d=>Object.hasOwn(d,'additiveDefault')))throw new SchemaSkew('settings preset is missing non-additive control: '+missing.find(d=>!Object.hasOwn(d,'additiveDefault')).key);
  for(const d of missing){
   if(!Object.hasOwn(d,'additiveDefault'))throw new SchemaSkew('settings preset is missing non-additive control: '+d.key);
   controls[d.key]=defaultDescriptor(d);add.set(d.param,routeValue(rawByKey.get(d.key).additiveDefault));defaults.push(d.key);
  }
  if(authored||Object.keys(controls).length||defaultMissing&&expected.length){normalized[field]=controls;normalized[count]=Object.keys(controls).length;}else{delete normalized[field];delete normalized[count];}
 }
 if((schema.excludedStateFields||[]).some(key=>input.stateExclusions?.[key]!==true)||(schema.forbiddenPresetFields||[]).some(key=>Object.hasOwn(input,key)))throw error('settings preset must explicitly exclude runtime and replay state');
 if(typeof input.route!=='string'||!input.route)throw error('settings preset requires an exact control route');
 const parsed=new URL(input.route,'http://preset.invalid'),entries=[...parsed.searchParams],remaining=new Map();
 for(const [key,v]of entries){if(remaining.has(key))throw error('settings preset route duplicates parameter '+key);remaining.set(key,v);}
 const activation=schema.activationParam||{};if(remaining.get(activation.key)!==activation.value)throw error('settings preset route omitted the native volume activation gate');remaining.delete(activation.key);
 for(const [key,v]of routed){if(remaining.get(key)!==v)throw error('settings preset route/control mismatch for '+key);remaining.delete(key);}
 for(const key of schema.routeExtraParams||[]){if(!remaining.has(key))throw new SchemaSkew('settings preset route omitted metadata parameter '+key);remaining.delete(key);}
 if(remaining.size)throw new SchemaSkew('settings preset route contains unexpected parameters: '+[...remaining.keys()].join(','));
 const query=entries.filter(([key])=>!remove.has(key)).map(([key,v])=>[key,replace.get(key)??v]);
 for(const [key,v]of add){if(entries.some(([k])=>k===key))throw error('settings preset route contains unowned additive parameter '+key);query.push([key,v]);}
 const question=input.route.indexOf('?'),fragment=input.route.indexOf('#');
 normalized.route=input.route.slice(0,question<0?(fragment<0?input.route.length:fragment):question)+'?'+query.map(([k,v])=>encodeQuery(k)+'='+encodeQuery(v)).join('&')+(fragment<0?'':input.route.slice(fragment));
 return{preset:normalized,schemaProjection:{identity:'kaminos-volume-settings-schema-projection-v1',sourceControlCount:input.controlCount??null,effectiveControlCount:normalized.controlCount??null,
  sourceRendererControlCount:input.rendererControlCount??0,effectiveRendererControlCount:normalized.rendererControlCount??0,sourcePresentationControlCount:input.presentationControlCount??0,effectivePresentationControlCount:normalized.presentationControlCount??0,
  defaultsApplied:defaults,retiredControlsStripped:retired,carriedControls:carried,unsupportedValuesDefaulted:replaced}};
}
const aliasSlug=label=>String(label||'').trim().replace(/[^A-Za-z0-9_.-]+/g,'-').replace(/^[.-]+|[.-]+$/g,'').toLowerCase().slice(0,96)||'unnamed-preset';
const timestamp=v=>typeof v==='string'?v:'';
const order=(a,b)=>codepointOrder(timestamp(b.updatedAt)||timestamp(b.publishedAt),timestamp(a.updatedAt)||timestamp(a.publishedAt))||codepointOrder(b.alias,a.alias);
const versionKey=e=>JSON.stringify([e.alias,e.presetId]);
export function createVolumePresetReader({repoRoot,volumeSettingsStore,sharedBasinStore,mountedPath}) {
 const layers=[{role:'local',storePath:volumeSettingsStore},...(sharedBasinStore&&sharedBasinStore!==volumeSettingsStore?[{role:'shared',storePath:sharedBasinStore}]:[])];
 async function info(path){try{return await stat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function object(root,part){const parsed=parseStored(await readFile(await mountedPath(root,part),'utf8'));if(!isObject(parsed.plain))throw error('settings preset JSON object required');return parsed;}
 async function schema(){const parsed=await object(repoRoot,'volume-settings-preset-schema-v2.json');validatePresetSchema(parsed.plain);return parsed;}
 async function alias(store,name,rawSchema,{compatible=true}={}){
  if(aliasSlug(name)!==name)throw error('volume settings preset alias is invalid');
  const d=(await object(store,'aliases/'+name+'.json')).plain;
  if(d.identity!=='kaminos-volume-settings-preset-alias-v1'||d.alias!==name||typeof d.label!=='string'||!d.label.trim()||!isId(d.presetId))throw error('volume settings preset alias identity mismatch');
  if(compatible&&d.schemaIdentity!==rawSchema.identity)throw error('volume settings preset alias schema mismatch');return d;
 }
 async function artifact(store,id,requested,parsedSchema,pointer=null){
  if(!isId(id))throw error('volume settings preset content id is invalid');
  const {plain:d,tokens}=await object(store,'presets/'+id+'.json'),schema=parsedSchema.plain;
  if(d.identity!=='kaminos-volume-settings-preset-artifact-v2'||d.presetId!==id||d.schemaIdentity!==schema.identity||!isObject(d.preset)||d.controlCount!==d.preset.controlCount)throw error('volume settings preset artifact identity/schema mismatch');
  const hash=contentHash(tokens.preset);if(id!=='vsp-'+hash||d.contentHash!=='sha256:'+hash||pointer&&pointer.contentHash!==d.contentHash)throw error('volume settings preset artifact content hash mismatch');
  const projected=project(d.preset,tokens.preset,schema,parsedSchema.tokens);
  const result={...d,sourceControlCount:d.preset.controlCount??null,sourceRendererControlCount:d.preset.rendererControlCount??0,sourcePresentationControlCount:d.preset.presentationControlCount??0,
   controlCount:projected.preset.controlCount,...projected,requestedPresetRef:requested,alias:pointer?.alias??null,label:pointer?.label??d.initialLabel??d.label??null,storePath:store};
  // The ported server projection validates descriptor types, exact source
  // routes and schema coverage. Keep Python float route spelling intact here;
  // the browser's separate JS String(number) policy is not a server gate.
  return result;
 }
 async function readInLayer(layer,ref,parsedSchema){const p=ref.startsWith('vsp-')?null:await alias(layer.storePath,ref,parsedSchema.plain);return{...await artifact(layer.storePath,p?.presetId??ref,ref,parsedSchema,p),storeRole:layer.role};}
 async function read(ref){
  if(typeof ref!=='string'||!ref.trim())throw error('volume settings preset id or alias is required');ref=ref.trim();
  const parsed=await schema();
  if(!ref.startsWith('vsp-')){
   if(aliasSlug(ref)!==ref)throw error('volume settings preset alias is invalid');
   for(const layer of [...layers].sort((a,b)=>Number(b.role==='shared')-Number(a.role==='shared')))if(await info(await mountedPath(layer.storePath,'aliases/'+ref+'.json')))return readInLayer(layer,ref,parsed);
  }else{
   if(!isId(ref))throw error('volume settings preset content id is invalid');
   for(const layer of layers){try{return await readInLayer(layer,ref,parsed);}catch(e){if(e.code!=='ENOENT')throw e;}}
  }
  throw error('volume settings preset not found in any basin store: '+ref,'ENOENT');
 }
 async function fileNames(store,folder,suffix){
  const path=await mountedPath(store,folder);if(!await info(path))return[];return(await readdir(path)).filter(n=>n.endsWith(suffix)).sort(codepointOrder);
 }
 async function listStore(layer,parsed){
  const store=layer.storePath;if(!(await info(store))?.isDirectory())throw error('Preset store is not mounted: '+store);
  const result={entries:[],earlierVersions:[],unavailableEntries:[],invalidAliases:[],invalidHistoryRows:[]},current=new Map();
  const unavailable=(p,e,extra={})=>({alias:p.alias,label:p.label,presetId:p.presetId,updatedAt:p.updatedAt??null,source:p.source||{},reason:e instanceof SchemaSkew?'schema-skew':'invalid-artifact',error:e.message,...extra});
  for(const name of await fileNames(store,'aliases','.json')){
   let p;const requested=name.slice(0,-5);
   // A structurally valid pointer owns the current label even when the
   // following artifact/schema read fails. Do not promote a local substitute.
   try{p=await alias(store,requested,parsed.plain,{compatible:false});}catch(e){result.invalidAliases.push({alias:requested,path:join(store,'aliases',name),error:e.message});continue;}
   current.set(p.alias,p.presetId);
   try{
    const d=await readInLayer(layer,p.alias,parsed),projection=d.schemaProjection;
    result.entries.push({alias:p.alias,label:d.label,presetId:d.presetId,contentHash:d.contentHash,schemaIdentity:d.schemaIdentity,controlCount:d.controlCount,
     rendererControlCount:Object.keys(d.preset.rendererControls||{}).length,presentationControlCount:Object.keys(d.preset.presentationControls||{}).length,
     ...Object.fromEntries(['defaultsApplied','retiredControlsStripped','carriedControls','unsupportedValuesDefaulted'].map(key=>[key,projection[key]||[]])),updatedAt:p.updatedAt??null,source:p.source||{}});
   }catch(e){result.unavailableEntries.push(unavailable(p,e));}
  }
  for(const name of await fileNames(store,'alias-history','.jsonl')){
   const alias=name.slice(0,-6),path=await mountedPath(store,'alias-history/'+name),rows=new Map();let line=0;
   for(const text of (await readFile(path,'utf8')).split(/\r?\n/)){
    line++;if(!text.trim())continue;
    try{const row=JSON.parse(text);if(!isObject(row)||!isId(row.presetId)||Object.hasOwn(row,'label')&&(typeof row.label!=='string'||!row.label.trim())||Object.hasOwn(row,'source')&&!isObject(row.source))throw error('label history row is not a basin version');rows.set(row.presetId,row);}
    catch(e){result.invalidHistoryRows.push({alias,path,line,error:e.message});}
   }
   for(const [id,row]of rows){
    if(current.get(alias)===id)continue;
    try{const d=await artifact(store,id,id,parsed);result.earlierVersions.push({alias,label:row.label||alias,presetId:id,contentHash:d.contentHash,publishedAt:row.publishedAt??null,source:row.source||{},reason:row.held?'held-label':'superseded-label',carriedControls:d.schemaProjection.carriedControls,unsupportedValuesDefaulted:d.schemaProjection.unsupportedValuesDefaulted});}
    catch(e){result.unavailableEntries.push(unavailable({alias,label:row.label||alias,presetId:id,updatedAt:row.publishedAt,source:row.source},e,{version:'earlier'}));}
   }
  }
  return result;
 }
 async function list(){
  const parsed=await schema(),listings=[];for(const layer of layers)listings.push({layer,...await listStore(layer,parsed)});
  const current=new Map(),displaced=[],earlier=new Map(),unavailable=new Map();
  for(const listing of [...listings].sort((a,b)=>Number(b.layer.role==='shared')-Number(a.layer.role==='shared'))){
   const located=listing.layer;
   for(const entry of [...listing.entries.map(e=>({...e,available:true})),...listing.unavailableEntries.filter(e=>e.version!=='earlier').map(e=>({...e,available:false}))]){
    const value={...entry,storeRole:located.role,storePath:located.storePath};
    if(!current.has(entry.alias))current.set(entry.alias,value);else if(current.get(entry.alias).presetId!==entry.presetId)displaced.push(value);
   }
  }
  const currentKeys=new Set([...current.values()].map(versionKey));
  for(const entry of current.values())if(!entry.available)unavailable.set(versionKey(entry),entry);
  for(const e of displaced){
   const key=versionKey(e);if(currentKeys.has(key))continue;
   if(e.available)earlier.set(key,{alias:e.alias,label:e.label,presetId:e.presetId,contentHash:e.contentHash,publishedAt:e.updatedAt,source:e.source,reason:'other-store-label',storeRole:e.storeRole,storePath:e.storePath,carriedControls:e.carriedControls||[],unsupportedValuesDefaulted:e.unsupportedValuesDefaulted||[]});
   else if(!unavailable.has(key))unavailable.set(key,{...e,version:'other-store'});
  }
  for(const listing of listings){
   const located={storeRole:listing.layer.role,storePath:listing.layer.storePath};
   for(const e of listing.earlierVersions){const key=versionKey(e);if(!currentKeys.has(key)&&!earlier.has(key))earlier.set(key,{...e,...located});}
   for(const e of listing.unavailableEntries){const key=versionKey(e);if(e.version==='earlier'&&!currentKeys.has(key)&&!earlier.has(key)&&!unavailable.has(key))unavailable.set(key,{...e,...located});}
  }
  const strip=e=>{const {available,...rest}=e;return rest;};
  return{identity:'kaminos-volume-settings-preset-index-v1',schemaIdentity:parsed.plain.identity,controlCount:parsed.plain.controlCount,
   rendererControlCount:(parsed.plain.rendererControls||[]).length,presentationControlCount:(parsed.plain.presentationControls||[]).length,storePath:volumeSettingsStore,
   stores:layers.map(({role,storePath})=>({role,storePath})),entries:[...current.values()].filter(e=>e.available).map(strip).sort(order),earlierVersions:[...earlier.values()].sort(order),unavailableEntries:[...unavailable.values()].map(strip).sort(order),
   invalidAliases:listings.flatMap(x=>x.invalidAliases.map(e=>({...e,storeRole:x.layer.role}))),invalidHistoryRows:listings.flatMap(x=>x.invalidHistoryRows.map(e=>({...e,storeRole:x.layer.role})))};
 }
 return{read,list,layers};
}
