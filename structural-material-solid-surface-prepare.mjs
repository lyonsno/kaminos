import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bindSolidSurface,applySolidSurfaceBinding } from './structural-material-solid-surface.mjs';
const [interiorPath,surfacePath,output,envelopeInput]=process.argv.slice(2);
if(!interiorPath||!surfacePath||!output)throw new Error('usage: node structural-material-solid-surface-prepare.mjs INTERIOR.json SURFACE.json REPORT.json ENVELOPE');
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});const report={status:'running',phase:'input',argv:process.argv,inputs:{}},save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)),hash=b=>createHash('sha256').update(b).digest('hex');save();
try{
 const start=performance.now(),interiorBytes=fs.readFileSync(interiorPath),surfaceBytes=fs.readFileSync(surfacePath),interior=JSON.parse(interiorBytes),surface=JSON.parse(surfaceBytes),envelope=Number(envelopeInput);
 report.inputs={interior:{path:path.resolve(interiorPath),sha256:hash(interiorBytes)},surface:{path:path.resolve(surfacePath),sha256:hash(surfaceBytes)}};
 if(interior.status!=='passed'||interior.route!=='ftetwild-cpu-wildmeshing-0.4.1'||surface.status!=='passed'||surface.route!=='imported-whole-solid-manifold-3.5.4'||interior.sourceSha256!==surface.sourceSha256)throw new Error('Matching admitted interior and source skin required');
 report.sourceSha256=surface.sourceSha256;report.phase='binding';save();report.binding=bindSolidSurface(interior,surface.vertices,{envelope});
 const transform=([x,y,z])=>[2-y,x+1,1.01*z+.02*x],points=interior.positions.map(transform),actual=applySolidSurfaceBinding(report.binding,points,{components:Array(points.length).fill(0)});
 report.affineError=Math.max(...actual.flatMap((p,i)=>p.map((v,a)=>Math.abs(v-transform(surface.vertices[i])[a]))));
 if(report.affineError>1e-10)throw new Error('Imported skin failed affine reproduction');
 report.triangles=surface.triangles;report.sourceVertices=surface.vertices;report.milliseconds=performance.now()-start;report.status='passed';report.phase='complete';report.claim='Actual imported skin binding and affine field control only; no rendered deformation or fracture surface';save();
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};save();process.exitCode=1;}
console.log(JSON.stringify({status:report.status,phase:report.phase,output,maxDistance:report.binding?.maxDistance,affineError:report.affineError,milliseconds:report.milliseconds,failure:report.failure?.message}));
