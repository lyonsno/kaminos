export async function registrationRequest(sourceUrl,targetUrl,{id,save,request=fetch}={}){
 const query=new URLSearchParams({sourceUrl,targetUrl});if(id)query.set('id',id);
 const response=await request('/api/asset-registrations?'+query,save?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(save)}:undefined);
 const result=await response.json();if(!response.ok)throw Error(result.error||`Registration HTTP ${response.status}`);
 if(save||id){if(result.registration?.schema!=='kaminos.asset-registration.v1'||!result.registration.id||!result.registration.recipe)throw Error('Missing saved registration receipt');}
 else if(!result.identity?.source?.sha256||!result.identity?.target?.sha256||!Array.isArray(result.registrations))throw Error('Missing registration identity or catalog');
 return result;
}
export function savedRegistrationURL(base,{sourceUrl,targetUrl,id}){
 const url=new URL(base);url.hash='';url.search='';url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','part-claims');url.searchParams.set('experiment_inputs',JSON.stringify({sourceUrl,targetUrl,registrationId:id}));return url.href;
}
