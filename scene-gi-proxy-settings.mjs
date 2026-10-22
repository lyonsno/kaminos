// An object's render settings for GI: whether its GI proxy is on, and which stored tier of its hero the proxy
// uses (scene-gi-proxies.mjs). Only mesh objects have them. A stored tier is chosen by face budget (the tiers
// Generate prepares: 500, 1000, 5000) or by relative geometric error with its statistic. "Off" means no proxy is
// held; whether the GI renderer then leaves the object out is its own pass policy.
export const GI_PROXY_FACE_TIERS=Object.freeze([500,1000,5000]);
export const GI_PROXY_ERROR_STATS=Object.freeze(['max','p95','mean']);
export const DEFAULT_GI_PROXY_SETTING=Object.freeze({enabled:true,selection:Object.freeze({faces:1000})});
export const canHaveGiProxy=record=>record?.type==='glb';
export function checkedGiProxySetting(record,value){
  if(!canHaveGiProxy(record))throw Error('GI proxy settings require a mesh object');
  if(typeof value?.enabled!=='boolean')throw Error('GI proxy enabled must be true or false');
  const s=value.selection??{};
  if('faces' in s&&('maxError' in s||'stat' in s))throw Error('GI proxy tier is chosen by faces or by error, not both');
  if('faces' in s){if(!GI_PROXY_FACE_TIERS.includes(s.faces))throw Error(`GI proxy faces must be ${GI_PROXY_FACE_TIERS.join(', ')}`);return {enabled:value.enabled,selection:{faces:s.faces}};}
  if('maxError' in s){
    if(!(Number.isFinite(s.maxError)&&s.maxError>=0))throw Error('GI proxy maxError must be a finite, non-negative relative error');
    if(!GI_PROXY_ERROR_STATS.includes(s.stat))throw Error('GI proxy error statistic must be max, p95 or mean');
    return {enabled:value.enabled,selection:{maxError:s.maxError,stat:s.stat}};}
  throw Error('GI proxy tier needs faces or maxError');
}
export function giProxySettingFor(record){
  if(!canHaveGiProxy(record))return null;
  return record.giProxy==null?structuredClone(DEFAULT_GI_PROXY_SETTING):checkedGiProxySetting(record,record.giProxy);
}
