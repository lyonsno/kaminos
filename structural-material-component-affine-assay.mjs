import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [nativePath,assetPath,output,radiusInput,planeInput]=process.argv.slice(2);
if(!nativePath||!assetPath||!output)throw new Error('usage: node structural-material-component-affine-assay.mjs NATIVE.json SOURCE.glb REPORT.json SUPPORT_RADIUS PLANE_JSON');
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});const report={status:'running',phase:'input',argv:process.argv},save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)),hash=b=>createHash('sha256').update(b).digest('hex');save();let surface;
try{
 const nativeBytes=fs.readFileSync(nativePath),native=JSON.parse(nativeBytes),assetBytes=fs.readFileSync(assetPath),radius=Number(radiusInput),plane=JSON.parse(planeInput);
 const root=path.dirname(fileURLToPath(import.meta.url));report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();report.runtime={executable:process.execPath,node:process.version,architecture:process.arch,platform:process.platform};report.sources=Object.fromEntries(['structural-material-component-affine-assay.mjs','structural-material-component-affine.mjs','structural-material-solid-fragments.mjs','structural-material-solid-surface.mjs','structural-material-stone-prepare.mjs','package-lock.json'].map(name=>[name,hash(fs.readFileSync(path.join(root,name)))]));
 if(native.status!=='passed'||native.observed?.identity?.backend!=='webgpu'||native.observed.identity.adapterFallback!==false||native.observed.resident.length!==1)throw new Error('One complete retained native material candidate required');
 if(native.observed.status!=='passed'||native.observed.route!=='kaminos.material-probe.native.v0')throw new Error('A passed native probe on the recorded route is required');
 const candidate=native.observed.resident[0],requiredStages=['rest','loaded','damaged','post-damage','released'];
 if(!['graph','pmb'].includes(candidate.kind))throw new Error('Supported native material kind required');
 if(!Array.isArray(candidate.stages)||new Set(candidate.stages.map(s=>s.name)).size!==candidate.stages.length||requiredStages.some(name=>candidate.stages.filter(s=>s.name===name).length!==1))throw new Error('Unique complete native stage coverage required');
 const runId=candidate.stages[0].state?.runId;
 for(const stage of candidate.stages){
  if(stage.state?.route!=='kaminos.deformable-material.colored-vbd.webgpu.v0')throw new Error(`Native resident route differs at ${stage.name}`);
  if(stage.state.kind!==candidate.kind)throw new Error(`Native material kind differs at ${stage.name}`);
  if(stage.state.runId!==runId||runId!==undefined&&(typeof runId!=='string'||!runId))throw new Error('Native resident factory identity changed during replay');
 }
 if(runId===undefined&&(typeof native.observed.runId!=='string'||!native.observed.runId))throw new Error('Historical single-probe identity is unavailable');
 if(!Array.isArray(plane)||plane.length!==4||!plane.every(Number.isFinite))throw new Error('Explicit plane control required');
 const preparationBytes=fs.readFileSync(path.join(native.prepared.root,'report.json'));if(hash(preparationBytes)!==native.prepared.manifestSha256)throw new Error('Native preparation source metadata changed');
 const preparation=JSON.parse(preparationBytes),interiorBytes=fs.readFileSync(preparation.input),interior=JSON.parse(interiorBytes),sourceBytes=fs.readFileSync(interior.source),source=JSON.parse(sourceBytes);
 if(hash(interiorBytes)!==preparation.inputSha256||hash(assetBytes)!==preparation.sourceSha256||interior.sourceSha256!==preparation.sourceSha256)throw new Error('Native preparation and source geometry identity differ');
 if(hash(sourceBytes)!==interior.inputSha256||source.status!=='passed'||source.route!=='imported-whole-solid-manifold-3.5.4'||source.sourceSha256!==preparation.sourceSha256)throw new Error('Admitted exterior source metadata changed or substituted');
 report.inputs={native:{path:path.resolve(nativePath),sha256:hash(nativeBytes)},asset:{path:path.resolve(assetPath),sha256:hash(assetBytes)},interior:{path:preparation.input,sha256:hash(interiorBytes)},source:{path:interior.source,sha256:hash(sourceBytes)}};
 report.radius=radius;report.plane=plane;report.phase='backend-import';save();
 const {prepareStoneFromGlb}=await import('./structural-material-stone-prepare.mjs'),{createPlaneFractureSurface}=await import('./structural-material-solid-fragments.mjs'),{bindSolidSurface,materialComponents}=await import('./structural-material-solid-surface.mjs'),{bindComponentAffineField,applyComponentAffineField}=await import('./structural-material-component-affine.mjs');report.phase='surface-event';save();
 const result=native.observed.resident[0],stages=Object.fromEntries(result.stages.map(s=>[s.name,s.state])),n=interior.positions.length,components=materialComponents(n,stages.damaged.bonds),volumes=interior.positions.map((_,i)=>stages.rest.state[i*16+3]/preparation.config.density);
 const prepared=prepareStoneFromGlb(assetBytes,{size:source.size,cellSize:Math.max(...source.size)*2});
 surface=await createPlaneFractureSurface(prepared.cells[0].geometry,{sourceSha256:preparation.sourceSha256});
 const material={runId:stages.damaged.runId??native.observed.runId,kind:result.kind,sourceSha256:preparation.sourceSha256};
 report.identityAuthority=stages.damaged.runId?'resident-factory-run':'retained-single-model-probe-run';
 const cut=surface.cut({id:'retained-native-plane-control',normal:plane.slice(0,3),offset:plane[3],rest:interior.positions,before:stages.loaded.bonds,after:stages.damaged.bonds,route:stages.damaged.route,kind:'explicit-control-plane',material}).witness;
 report.surface=cut;report.pieces=[];report.phase='component-correspondence';save();
 for(const piece of cut.pieces){
  const memberships=new Set(interior.positions.flatMap((p,i)=>piece.halfspaces.every(h=>h.side*(h.normal.reduce((s,v,a)=>s+v*p[a],0)-h.offset)>=0)?[components[i]]:[]));
  if(memberships.size!==1)throw new Error('Surface piece does not identify exactly one current material component');const component=[...memberships][0];
  const vertices=Array.from({length:piece.geometry.properties.length/piece.geometry.numProp},(_,i)=>piece.geometry.properties.slice(i*piece.geometry.numProp,i*piece.geometry.numProp+3));
  let oldBinding;try{bindSolidSurface(interior,vertices,{envelope:.003,components,component});oldBinding={accepted:true};}catch(error){oldBinding={accepted:false,message:error.message};}
  const binding=bindComponentAffineField(interior.positions,vertices,{components,component,volumes,radius}),transform=([x,y,z])=>[2-y,x+1,1.01*z+.02*x],affine=applyComponentAffineField(binding,interior.positions.map(transform),{components});
  const affineError=Math.max(...affine.flatMap((p,i)=>p.map((v,a)=>Math.abs(v-transform(vertices[i])[a]))));if(affineError>1e-10)throw new Error('Component correspondence failed independent affine control');
  const fields={};for(const name of ['damaged','post-damage','released']){const current=interior.positions.map((_,i)=>stages[name].state.slice(i*16+4,i*16+7));fields[name]=applyComponentAffineField(binding,current,{components:materialComponents(n,stages[name].bonds)});}
  report.pieces.push({id:piece.id,component,oldBinding,binding,affineError,fields,maxReleasedMotion:Math.max(...fields.released.map((p,i)=>Math.hypot(...p.map((v,a)=>v-vertices[i][a]))))});save();
 }
 report.status='passed';report.phase='complete';report.claim='Retained native explicit-plane release -> actual cut solid -> component-owned finite-support surface reconstruction; no rendered or force-selected shard claim';save();
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};save();process.exitCode=1;}
finally{surface?.dispose();console.log(JSON.stringify({status:report.status,phase:report.phase,output,failure:report.failure?.message}));}
