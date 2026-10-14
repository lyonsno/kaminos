import {createServer} from 'node:http';
import {mkdir, readFile, writeFile, readdir, stat, realpath, rename, unlink, link} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join, resolve, relative, dirname, basename, extname, isAbsolute} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const imageExtensions=new Set(['.png','.jpg','.jpeg','.webp']);
const mediaTypes={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
  '.svg':'image/svg+xml','.wasm':'application/wasm','.glb':'model/gltf-binary','.gltf':'model/gltf+json',
  '.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain'};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async path=>{try{return await stat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const within=(root,path)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('../');};
const failure=(message,status=400,phase='request')=>Object.assign(new Error(message),{status,phase});
const fileSource=(root,path)=>'/api/read?'+new URLSearchParams({root,path});

// Preserve the existing browser-facing source fields; absence stays explicit.
export function appSourceIdentity(repoRoot) {
  const source={repoRoot,branch:'unavailable',commit:'unavailable',dirty:null};
  try {
    source.branch=execFileSync('git',['rev-parse','--abbrev-ref','HEAD'],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    source.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    source.dirty=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());
  } catch { /* An unversioned caller root is served, never labelled verified. */ }
  return source;
}

async function mountedPath(root,path='') {
  const target=resolve(root,path);
  if(!within(root,target))throw failure('Path traversal',403);
  let ancestor=target;
  while(!await exists(ancestor))ancestor=dirname(ancestor);
  const actualRoot=await realpath(root),actualAncestor=await realpath(ancestor);
  if(!within(actualRoot,actualAncestor))throw failure('Path traversal',403);
  return target;
}

async function atomicJson(path,value) {
  const temporary=join(dirname(path),`.${basename(path)}.${randomUUID()}.tmp`);
  try {await writeFile(temporary,JSON.stringify(value)+'\n',{flag:'wx'});await rename(temporary,path);}
  finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

async function bodyBytes(request) {
  const parts=[];
  try {for await(const part of request)parts.push(part);}
  catch(error){throw failure(`Incomplete request body: ${error.message}`,400,'request-body');}
  return Buffer.concat(parts);
}

function jsonResponse(response,value,status=200,head=false) {
  const bytes=Buffer.from(JSON.stringify(value));
  response.writeHead(status,{'Content-Type':'application/json','Content-Length':bytes.length,'Cache-Control':'no-store'});
  response.end(head?undefined:bytes);
}

async function serveFile(request,response,path) {
  const info=await exists(path);
  if(!info?.isFile())throw failure('Not a file',404);
  let start=0,end=info.size-1,status=200;
  const headers={'Content-Type':mediaTypes[extname(path).toLowerCase()]||'application/octet-stream',
    'Content-Length':info.size,'Accept-Ranges':'bytes','Cache-Control':'no-store'};
  if(request.headers.range) {
    const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if(!match||(!match[1]&&!match[2])) {response.writeHead(416,{'Content-Range':`bytes */${info.size}`});response.end();return;}
    if(match[1]) {start=Number(match[1]);end=match[2]?Number(match[2]):end;}
    else start=Math.max(0,info.size-Number(match[2]));
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size||end<0) {
      response.writeHead(416,{'Content-Range':`bytes */${info.size}`});response.end();return;
    }
    end=Math.min(end,info.size-1);status=206;
    headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;headers['Content-Length']=end-start+1;
  }
  response.writeHead(status,headers);
  if(request.method==='HEAD'||info.size===0){response.end();return;}
  const stream=createReadStream(path,{start,end});
  stream.once('error',error=>response.destroy(error));response.once('close',()=>stream.destroy());stream.pipe(response);
}

async function filesUnder(root,path='') {
  const output=[];
  for(const entry of await readdir(join(root,path),{withFileTypes:true})) {
    if(entry.name.startsWith('.'))continue;
    const part=[path,entry.name].filter(Boolean).join('/');
    if(entry.isDirectory())output.push(...await filesUnder(root,part));
    else if(entry.isFile()||entry.isSymbolicLink())output.push(part);
  }
  return output;
}

// First ordinary app serving slice. Other owner services return an explicit 501.
export async function createKaminosAppHost({repoRoot,stateRoot,sam3PacketRoot=null,roots:configuredRoots={}}) {
  if(!repoRoot||!stateRoot)throw failure('repoRoot and stateRoot are required',400,'configuration');
  repoRoot=await realpath(resolve(repoRoot));stateRoot=resolve(stateRoot);
  // A worktree may share installed dependencies. Name the exact directory
  // reached through its own node_modules, without admitting other symlinks.
  const dependencyPath=join(repoRoot,'node_modules');
  const dependencyRoot=(await exists(dependencyPath))?.isDirectory()?await realpath(dependencyPath):null;
  await mkdir(stateRoot,{recursive:true});stateRoot=await realpath(stateRoot);
  const roots={
    'generated-meshes':join(stateRoot,'assets','generated-meshes'),
    'image-inbox':join(stateRoot,'assets','images','inbox'),
    scenes:join(stateRoot,'scenes'),scratch:join(stateRoot,'scratch'),...configuredRoots};
  for(const [id,path] of Object.entries(roots))roots[id]=resolve(path);
  for(const id of ['generated-meshes','image-inbox','scenes','scratch'])await mkdir(roots[id],{recursive:true});
  if(sam3PacketRoot)sam3PacketRoot=resolve(sam3PacketRoot);
  const config={repoRoot,stateRoot,sam3PacketRoot,dependencyRoot,roots};
  const implementation=appSourceIdentity(dirname(fileURLToPath(import.meta.url)));
  async function rootFor(id) {
    if(!roots[id])throw failure(`Unknown root: ${id}`);
    if(!(await exists(roots[id]))?.isDirectory())throw failure('Asset collection is not mounted',404);
    return roots[id];
  }
  async function imageEntry(path) {
    const root=roots['image-inbox'],file=await mountedPath(root,path),info=await stat(file);
    const metadataPath=join(dirname(file),`.${basename(file)}.json`);
    const metadata=await exists(metadataPath)?JSON.parse(await readFile(metadataPath,'utf8')):null;
    const name=metadata?.name||basename(file);
    return {id:`image-inbox:${path}`,kind:'image',stage:'working',root_id:'image-inbox',root_label:'Local Image Inbox',
      name,path,size:info.size,mtime:info.mtimeMs/1000,source:fileSource('image-inbox',path),
      ...(metadata?.sha256?{sha256:metadata.sha256}:{}),correction:null,
      display:{title:name,load_label:'Use Image'},
      renderability:{schema:'kaminos.image-preview.v0',status:'image',previewState:'direct-read',reason:'Local image served through /api/read'}};
  }
  async function catalog(collection) {
    if(!['image-inbox','generated-meshes'].includes(collection))throw failure(`Authoring collection not implemented: ${collection}`,501,'unsupported-service');
    const root=await rootFor(collection),entries=[],warnings=[];
    for(const path of await filesUnder(root)) {
      const extension=extname(path).toLowerCase(),kind=imageExtensions.has(extension)?'image':extension==='.glb'?'mesh':null;
      if(!kind)continue;
      try {
        const file=await mountedPath(root,path),info=await stat(file);if(!info.isFile())continue;
        const source=fileSource(collection,path);
        if(collection==='image-inbox') {const entry=await imageEntry(path);entries.push({...entry,id:source,root:collection,label:entry.name});}
        else entries.push({id:source,kind,root:collection,path,name:basename(file),label:basename(file),source,size:info.size,mtime:info.mtimeMs/1000});
      }catch(error){warnings.push({source:path,reason:error.message});}
    }
    entries.sort((a,b)=>b.mtime-a.mtime||a.id.localeCompare(b.id));
    return {schema:'kaminos.authoring-assets.v1',collection,entries,warnings,unavailableCount:0};
  }
  async function ingestImage(request,name) {
    if(!name||basename(name)!==name||name.includes('\\'))throw failure('Path traversal');
    const extension=extname(name).toLowerCase();if(!imageExtensions.has(extension))throw failure('image must be PNG, JPEG, or WebP');
    const bytes=await bodyBytes(request);if(!bytes.length)throw failure('non-empty image body required');
    const hash=digest(bytes),storageName=digest(name)+extension,root=roots['image-inbox'];
    const directory=await mountedPath(root,hash);await mkdir(directory,{recursive:true});
    const path=`${hash}/${storageName}`,target=await mountedPath(root,path);
    try {await writeFile(target,bytes,{flag:'wx'});}
    catch(error){if(error.code!=='EEXIST')throw error;if(!(await readFile(target)).equals(bytes))throw failure('image asset content identity collision');}
    await atomicJson(join(directory,`.${storageName}.json`),{schema:'kaminos.image-asset.v0',name,sha256:'sha256:'+hash});
    return {schema:'kaminos.asset-ingest.v0',kind:'image',entry:await imageEntry(path)};
  }
  async function saveScene(request) {
    let data;try {data=JSON.parse((await bodyBytes(request)).toString('utf8'));}catch{throw failure('Invalid JSON');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw failure('Scene must be a JSON object');
    const saveAs=data._saveAsName,overwrite=data._overwrite===true,hint=data._filename;
    delete data._saveAsName;delete data._overwrite;delete data._filename;
    let filename;
    if(saveAs!==undefined) {
      const stem=basename(String(saveAs).trim()).replace(/\.kaminos\.json$/,'').replace(/\s+/g,'-').replace(/[^\p{L}\p{N}._-]/gu,'').replace(/^[.-]+|[.-]+$/g,'');
      if(!stem)throw failure('Scene name has no usable characters');
      filename=stem+'.kaminos.json';
      if(await exists(await mountedPath(roots.scenes,filename))&&!overwrite)throw Object.assign(failure(`${filename} already exists`,409),{exists:filename});
    }else if(typeof hint==='string'&&hint===basename(hint)&&await exists(await mountedPath(roots.scenes,hint)))filename=hint;
    if(!filename) {
      const model=basename(data.model?.fileName||'scene',extname(data.model?.fileName||''));
      const timestamp=String(data.timestamp||'').slice(0,19).replace(/:/g,'-').replace('T','_');
      filename=`${model}_${timestamp}_${randomUUID().replaceAll('-','')}.kaminos.json`.replace(/[^\p{L}\p{N}._-]/gu,'');
    }
    const path=await mountedPath(roots.scenes,filename);await atomicJson(path,data);return {saved:filename,path};
  }
  async function ingestMesh(request) {
    const bytes=await bodyBytes(request);
    if(bytes.length<20)throw failure('GLB header and first chunk required');
    if(bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw failure('Invalid GLB version or length');
    for(let offset=12;offset<bytes.length;) {
      if(offset+8>bytes.length)throw failure('Incomplete GLB chunk header');
      const length=bytes.readUInt32LE(offset);
      if(length%4||offset+8+length>bytes.length)throw failure('Invalid GLB chunk length');
      if(offset===12&&bytes.toString('ascii',offset+4,offset+8)!=='JSON')throw failure('First GLB chunk must be JSON');
      offset+=8+length;
    }
    const hash=digest(bytes),root=roots['generated-meshes'],target=await mountedPath(root,hash+'.glb');
    const temporary=join(root,`.mesh-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary,bytes,{flag:'wx'});
      try {await link(temporary,target);}
      catch(error) {if(error.code!=='EEXIST')throw error;if(!(await readFile(target)).equals(bytes))throw failure('Stored GLB content identity conflict');}
    }finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    return {schema:'kaminos.generated-mesh.v0',sha256:hash,bytes:bytes.length,source:`/api/read?root=generated-meshes&path=${hash}.glb`};
  }
  const server=createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Cache-Control','no-store');
    try {
      const url=new URL(request.url,'http://localhost'),q=url.searchParams,head=request.method==='HEAD';
      if(['GET','HEAD'].includes(request.method)) {
        if(url.pathname==='/api/runtime-config') {
          const mounted=Boolean(sam3PacketRoot&&(await exists(join(sam3PacketRoot,'tensor-manifest.json')))?.isFile());
          jsonResponse(response,{schema:'kaminos.runtime-config.v0',hybridSplatOverlayModuleUrl:null,
            sam3:sam3PacketRoot?{manifestUrl:'/sam3-packet/tensor-manifest.json',modelRoot:sam3PacketRoot,mounted}:null,
            source:{...appSourceIdentity(repoRoot),serverPort:server.address().port},
            applicationHost:{runtime:'node',repoRoot,stateRoot,dependencyRoot,implementation,implemented:['static','sam3-packet','images','scene-persistence']}},200,head);return;
        }
        if(url.pathname==='/api/roots') {
          const value={};for(const [id,path] of Object.entries(roots))value[id]={path,exists:Boolean(await exists(path))};
          jsonResponse(response,value,200,head);return;
        }
        if(url.pathname==='/api/authoring-assets') {jsonResponse(response,await catalog(q.get('collection')||'generated-meshes'),200,head);return;}
        if(url.pathname==='/api/assets') {
          const kind=q.get('kind')||'splat';if(!['image','all'].includes(kind))throw failure(`Asset kind not implemented: ${kind}`,501,'unsupported-service');
          const entries=(await catalog('image-inbox')).entries;
          jsonResponse(response,{schema:'kaminos.asset-index.v0',kind,roots:[{id:'image-inbox',label:'Local Image Inbox',kind:'image',stage:'working',path:roots['image-inbox']}],entries},200,head);return;
        }
        if(url.pathname==='/api/browse') {
          const id=q.get('root')||'scratch',part=q.get('path')||'',root=await rootFor(id),path=await mountedPath(root,part),info=await exists(path);
          if(!info)throw failure('Not found',404);
          if(info.isFile()){jsonResponse(response,{type:'file',name:basename(path),size:info.size,path},200,head);return;}
          const entries=[];
          for(const name of (await readdir(path)).sort()) {
            if(name.startsWith('.'))continue;
            const file=await mountedPath(root,join(part,name)),entry=await stat(file);
            entries.push({name,type:entry.isDirectory()?'dir':'file',size:entry.isFile()?entry.size:null});
          }
          jsonResponse(response,{type:'dir',root:id,path:part,entries},200,head);return;
        }
        if(url.pathname==='/api/read') {
          const root=await rootFor(q.get('root')||'scratch'),path=await mountedPath(root,q.get('path')||'');
          if(!(await exists(path))?.isFile())throw failure('Not a file',404);
          const extension=extname(path).toLowerCase();
          if(extension==='.json')jsonResponse(response,JSON.parse(await readFile(path,'utf8')),200,head);
          else if(mediaTypes[extension]||['.exr','.ply','.spz','.bin'].includes(extension))await serveFile(request,response,path);
          else jsonResponse(response,{content:await readFile(path,'utf8')},200,head);
          return;
        }
        if(url.pathname.startsWith('/sam3-packet/')) {
          if(!sam3PacketRoot||!(await exists(sam3PacketRoot))?.isDirectory())throw failure('SAM packet is not mounted',404);
          await serveFile(request,response,await mountedPath(sam3PacketRoot,decodeURIComponent(url.pathname.slice('/sam3-packet/'.length))));return;
        }
        if(!url.pathname.startsWith('/api/')) {
          if(url.pathname.startsWith('/node_modules/')) {
            if(!dependencyRoot)throw failure('Frontend dependencies are not installed',404);
            await serveFile(request,response,await mountedPath(dependencyRoot,decodeURIComponent(url.pathname.slice('/node_modules/'.length))));return;
          }
          await serveFile(request,response,await mountedPath(repoRoot,decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1))));return;
        }
      }
      if(request.method==='POST'&&url.pathname==='/api/ingest-image') {jsonResponse(response,await ingestImage(request,q.get('name')));return;}
      if(request.method==='POST'&&url.pathname==='/api/ingest-mesh') {jsonResponse(response,await ingestMesh(request));return;}
      if(request.method==='POST'&&url.pathname==='/api/save-scene') {jsonResponse(response,await saveScene(request));return;}
      throw failure(`Node application service not implemented: ${url.pathname}`,501,'unsupported-service');
    }catch(error) {
      if(!response.headersSent&&!response.destroyed)jsonResponse(response,{error:error.message,phase:error.phase||'request',...(error.exists?{exists:error.exists}:{})},error.status||(error.code==='ENOENT'?404:500));
      else response.destroy(error);
    }
  });
  return {server,config,
    listen:(port,host)=>new Promise((resolve,reject)=>{const failed=error=>{server.off('listening',listening);reject(error);};const listening=()=>{server.off('error',failed);resolve();};server.once('error',failed);server.once('listening',listening);server.listen(port,host);}),
    close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),
  };
}
