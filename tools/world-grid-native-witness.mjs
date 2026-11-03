import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validatePressureWitness} from './world-grid-witness-contract.mjs';
const [out]=process.argv.slice(2);
if(!out)throw Error('Caller-owned output directory required');
await fs.mkdir(out,{recursive:true});
const root=process.cwd(),report={status:'failed',phase:'source',root},files=['volume-world-smoke.mjs','world-pressure-grid-witness.mjs','tools/world-grid-native-witness.mjs','tools/world-grid-witness-contract.mjs'];
let browser,server;
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex')])));
try {
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.source=await hashes();
 report.executable=process.env.CHROME_EXECUTABLE;
 assert.ok(report.executable?.includes('Google Chrome for Testing'),'Independent Chrome for Testing required');
 server=http.createServer(async(req,res)=>{
  try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
   if(!file.startsWith(root+'/'))throw Error('outside source');
   res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 report.phase='browser';
 browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=await browser.newPage();
 await page.goto(origin+'/world-pressure-grid-witness.mjs');
 report.phase='native';
 report.raw=await page.evaluate(async()=>await(await import('/world-pressure-grid-witness.mjs')).probePressureGrids());
 validatePressureWitness(report.raw);
 report.phase='numerics';report.checks=[];
 for(const c of report.raw.cases){
  const d=c.plan.flowDims,pd=c.plan.pressureDims,h=c.plan.flowPitch,ph=c.plan.pressurePitch,r=d[0]/pd[0];
  const index=(q,dim)=>q[0]+dim[0]*(q[1]+dim[1]*q[2]);
  const inside=(q,dim)=>q.every((v,a)=>v>=0&&v<dim[a]);
  const shifted=(q,a,s)=>q.map((v,k)=>v+(a===k?s:0));
  const v=c.arrays['world smoke flow 1'],actual=c.arrays['world smoke flow 0'],rhs=c.arrays['world smoke pressure rhs and occupancy'];
  const face=(q,a)=>v[4*index(q.map((v,k)=>Math.max(0,Math.min(d[k]-1,v))),d)+a];
  const div=q=>[0,1,2].reduce((s,a)=>s+face(q,a)-face(shifted(q,a,-1),a),0)/h;
  const expectedRhs=new Float64Array(c.plan.pressureCells);
  for(let z=0;z<pd[2];z++)for(let y=0;y<pd[1];y++)for(let x=0;x<pd[0];x++){
   let sum=0;
   for(let dz=0;dz<r;dz++)for(let dy=0;dy<r;dy++)for(let dx=0;dx<r;dx++)sum+=div([x*r+dx,y*r+dy,z*r+dz]);
   expectedRhs[index([x,y,z],pd)]=sum/r**3;
  }
  let p=new Float64Array(c.plan.pressureCells);
  for(let step=0;step<12;step++){
   const next=new Float64Array(p.length);
   for(let z=0;z<pd[2];z++)for(let y=0;y<pd[1];y++)for(let x=0;x<pd[0];x++){
    const q=[x,y,z];let sum=0;
    for(let a=0;a<3;a++)for(const s of [-1,1]){const n=shifted(q,a,s);if(inside(n,pd))sum+=p[index(n,pd)];}
    next[index(q,pd)]=(sum-expectedRhs[index(q,pd)]*ph*ph)/6;
   }p=next;
  }
  const pressureAt=q=>inside(q,pd)?p[index(q,pd)]:0;
  const grad=(q,a)=>(pressureAt(shifted(q,a,1))-pressureAt(q))/ph;
  let maxRhsError=0,maxPressureError=0,maxVelocityError=0;
  for(let i=0;i<p.length;i++){maxRhsError=Math.max(maxRhsError,Math.abs(rhs[2*i]-expectedRhs[i]));maxPressureError=Math.max(maxPressureError,Math.abs(c.arrays['world smoke pressure 0'][i]-p[i]));}
  for(let z=0;z<d[2];z++)for(let y=0;y<d[1];y++)for(let x=0;x<d[0];x++)for(let a=0;a<3;a++){
   const cell=[x,y,z],q=cell.map((v,k)=>(v+(a===k?1:.5))/r-(a===k?1:.5)),base=q.map(Math.floor),f=q.map((v,k)=>v-base[k]);let g=0;
   for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const off=[dx,dy,dz],n=base.map((v,k)=>Math.max(a===k?-1:0,Math.min(pd[k]-1,v+off[k])));
    const weight=off.reduce((s,v,k)=>s*(v?f[k]:1-f[k]),1);g+=weight*grad(n,a);
   }
   const i=4*index(cell,d)+a;maxVelocityError=Math.max(maxVelocityError,Math.abs(actual[i]-(v[i]-g)));
  }
  report.checks.push({pressure:pd,maxRhsError,maxPressureError,maxVelocityError});
  assert.ok([maxRhsError,maxPressureError,maxVelocityError].every(v=>Number.isFinite(v)&&v<2e-6));
 }
 assert.deepEqual(await hashes(),report.source,'Source changed during conformance');
 report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,phase:report.phase,checks:report.checks,error:report.error}));
