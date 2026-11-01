// Offline GPU/CPU parity and native-consumer witness. Runtime never calls this.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {terrainConfig,initialState,transportStep} from '../experiments/hill-terrain/model.mjs';
import {validateTerrainRead,compareTerrainState} from '../experiments/hill-terrain/witness.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,v,i,a)=>i%2?pairs:[...pairs,[v.replace(/^--/,''),a[i+1]]],[]));
if(!args.out)throw Error('--out is required');
const out=path.resolve(args.out),root=path.resolve(args.root??'.');await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'inputs',requested:{...args},root,frames:[],comparisons:[],inputs:[],errors:[],offlineReadback:true,performanceClaim:false};let browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
try{
 for(const key of ['url','browser','playwright'])if(!args[key])throw Error('--'+key+' is required');
 if(/\/Applications\/Google Chrome\.app\//.test(args.browser))throw Error('Independent automation browser required');
 report.source={head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}),files:{}};
 report.runtime=await(await fetch(new URL('/api/runtime-config',args.url))).json();
 for(const file of ['experiments/hill-terrain.experiment.mjs','experiments/hill-terrain/gpu.mjs','experiments/hill-terrain/model.mjs']){
  const local=await fs.readFile(path.join(root,file)),res=await fetch(new URL('/'+file,args.url));assert.ok(res.ok,'Missing served source '+file);const served=Buffer.from(await res.arrayBuffer());assert.ok(local.equals(served),'Wrong served source '+file);report.source.files[file]=createHash('sha256').update(local).digest('hex');
 }
 report.phase='browser';await save();const {chromium}=await import(path.resolve(args.playwright));
 browser=await chromium.launch({executablePath:args.browser,headless:true,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});
 page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 const invoke=(name,input)=>{report.inputs.push({name,input});return page.evaluate(({name,input})=>window.kaminosWorkbenchExperiments.invoke(name,input),{name,input});};
 const read=()=>page.evaluate(()=>window.kaminosHillTerrain.read());
 const settled=async()=>{await page.waitForFunction(()=>window.kaminosHillTerrain?.read().prepared||window.kaminosHillTerrain?.read().error);validateTerrainRead(await read());};
 const capture=async name=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const state=await read();validateTerrainRead(state);await page.screenshot({path:path.join(out,name+'.png')});report.frames.push({file:name+'.png',state});await save();};
 const snapshot=async name=>{const value=await page.evaluate(async()=>{const s=await window.kaminosHillTerrain.snapshot();return{identity:s.identity,values:Array.from(s.values)};});const values=Float32Array.from(value.values);await fs.writeFile(path.join(out,name+'.f32'),Buffer.from(values.buffer));await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(value.identity,null,2));return values;};
 const config=terrainConfig({resolution:33,seed:47,uplift:0});
 const url=new URL(args.url);url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','hill-terrain');url.searchParams.set('experiment_inputs',JSON.stringify({...config,prepareSteps:0}));report.url=url.href;
 report.phase='initial';await page.goto(url.href);await settled();validateTerrainRead(await read(),{...config,steps:0});report.surface=await page.evaluate(()=>{const s=window.kaminosHillTerrain.gpu();return{stateBytes:s.state?.size,positionBytes:s.positions?.size,normalBytes:s.normals?.size,transform:s.localToWorld,resolution:s.resolution};});assert.equal(report.surface.stateBytes,33*33*16);assert.equal(report.surface.positionBytes,33*33*16);assert.equal(report.surface.normalBytes,33*33*16);assert.equal(report.surface.transform.length,16);let expected=initialState(config),actual=await snapshot('initial');report.comparisons.push({name:'initial',...compareTerrainState(actual,expected)});
 report.phase='transport';await invoke('advance',8);for(let i=0;i<8;i++)expected=transportStep(expected,config,.05);validateTerrainRead(await read(),{steps:8});actual=await snapshot('transport');report.comparisons.push({name:'transport',...compareTerrainState(actual,expected)});
 assert.ok(Math.abs(report.comparisons[0].soil-report.comparisons[1].soil)<1e-4,'Loose mass must be conserved');
 report.phase='uplift';await invoke('setMaterial',{uplift:.2});await invoke('advance',5);for(let i=0;i<5;i++)expected=transportStep(expected,{...config,uplift:.2},.05);validateTerrainRead(await read(),{steps:13,uplift:.2});actual=await snapshot('uplift');report.comparisons.push({name:'uplift',...compareTerrainState(actual,expected)});
 report.phase='native-visual';await page.evaluate(()=>window.kaminosWorkbenchExperiments.open('hill-terrain',{seed:47,uplift:.16}));await settled();await capture('basin-before');const before=await snapshot('basin-before');await invoke('advance',160);const after=await snapshot('basin-after');assert.ok(after.some((v,i)=>i%4===0&&v-before[i]>.5),'Uplift must change the actual GPU terrain');await capture('basin-after');
 report.phase='native-controls';await page.getByRole('button',{name:'Run terrain',exact:true}).click();await page.waitForFunction(()=>window.kaminosHillTerrain.read().steps>=164);await page.getByRole('button',{name:'Pause terrain',exact:true}).click();assert.equal((await read()).playing,false);
 await page.getByRole('combobox',{name:'Landscape structure',exact:true}).selectOption('saddle');await settled();validateTerrainRead(await read(),{layout:'saddle',steps:0});await capture('saddle');
 report.phase='lifetime';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert.equal(await page.evaluate(()=>Boolean(window.kaminosHillTerrain)),false);
 assert.equal(report.errors.length,0,report.errors.join('\n'));report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure={phase:report.phase,message:e.message,stack:e.stack};if(page){try{report.last=await page.evaluate(()=>window.kaminosHillTerrain?.read());await page.screenshot({path:path.join(out,'failure.png')});}catch(error){report.captureError=error.message;}}process.exitCode=1;
}finally{try{await browser?.close();report.browserClosed=true;}catch(e){report.browserClosed=false;report.closeError=e.message;process.exitCode=1;}await save();console.log(JSON.stringify({status:report.status,phase:report.phase,report:path.join(out,'report.json'),failure:report.failure?.message}));}
