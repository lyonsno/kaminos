// kaminos-test: node
import assert from 'node:assert/strict';
import {createGranularPreparation,preparationSource} from '../granular-preparation.mjs';
const recipe={count:12,width:.04,seed:7,dt:1/240,pourRate:60};
const m=createGranularPreparation(recipe);
assert.ok(Array.isArray(m.snapshot().ingredients),'mixture ingredient inventory is missing');
assert.equal(m.snapshot().ingredients.length,12,'the mixture must retain all twelve real grain geometries before pouring');
assert.equal(m.snapshot().grains.length,0,'unprepared ingredients are not a fabricated settled bed');
m.start('pour');while(m.read().phase)m.advance(.025);
assert.equal(m.snapshot().grains.length,12,'pouring retains every grain');
const poured=m.snapshot();m.start('settle',{seconds:.3});while(m.read().phase)m.advance(.025);
const settled=m.snapshot();assert.ok(settled.grains.some((g,i)=>g.position[1]<poured.grains[i].position[1]-.0001),'actual gravity must settle poured grains');
const mass=m.read().mass,control=createGranularPreparation(null,settled);control.start('settle',{seconds:.12});while(control.read().phase)control.advance(.025);
m.start('compress',{seconds:.12,strain:.25});while(m.read().phase)m.advance(.025);
assert.equal(m.read().mass,mass);assert.ok(m.snapshot().lidHeight<settled.lidHeight,'a physical lid must move into the material');
assert.ok(m.snapshot().grains.some((g,i)=>Math.hypot(...g.position.map((v,k)=>v-control.snapshot().grains[i].position[k]))>.00001),'platen contact must alter the grains relative to an equally advanced unpressed control');control.dispose();
m.start('unload',{seconds:.1});while(m.read().phase)m.advance(.025);assert.ok(m.snapshot().lidHeight>m.read().top);
m.start('shake',{seconds:.1,amplitude:.001,frequency:10});while(m.read().phase)m.advance(.025);
assert.equal(m.read().mass,mass);assert.equal(m.snapshot().containerX,0,'shaking returns the actual container, not only its visible mesh');
const s=m.snapshot(),restored=createGranularPreparation(null,s);assert.deepEqual(restored.snapshot(),s,'checkpoint retains mixture, preparation, geometry and mechanical state');
const source=preparationSource(s);assert.ok(source.triangles.length>12*12);assert.equal(source.config.snapshot.grains.length,12);assert.equal(source.materials.length,4);
for(const g of s.ingredients){assert.ok(g.volume>0);for(const f of g.faces){const[a,b,c]=f.map(i=>g.vertices[i]),n=[(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])];assert.ok(g.vertices.every(p=>n.reduce((t,v,k)=>t+v*(p[k]-a[k]),0)<1e-12),'collision and render geometry must use the same convex hull');}}
assert.throws(()=>createGranularPreparation({count:2.5}),/count/i);assert.throws(()=>m.start('compress',{seconds:-1}),/duration/i);assert.deepEqual(m.snapshot(),s,'invalid preparation preserves the current specimen');
restored.dispose();m.dispose();console.log('granular mixture, gravity, lid, shaking, conservation, source and checkpoint pass');
const {planPreparation}=await import('../granular-preparation.mjs');
assert.throws(()=>planPreparation({count:1000},{availableBytes:1024}),/storage/i,'oversized mixture fails before allocation');
assert.equal(planPreparation({count:12},{availableBytes:1024**3}).count,12,'planning never silently lowers grain count');
const {createMaterialTeacherSource}=await import('../material-teacher-source.mjs');
assert.equal(createMaterialTeacherSource({kind:'granular-preparation',snapshot:s}).config.kind,'granular-preparation','the real fit source must consume the frozen preparation');
assert.throws(()=>createMaterialTeacherSource({kind:'granular-preparation'}),/snapshot/i,'missing preparation cannot fall back to decorative ground');

const {preparationCollisionHull}=await import('../granular-preparation.mjs');
const hullCheck=preparationCollisionHull(s.ingredients[0]),undirected=new Set(s.ingredients[0].faces.flatMap(f=>f.map((a,i)=>[a,f[(i+1)%f.length]].sort((a,b)=>a-b).join(':'))));
assert.equal(hullCheck.uniqueEdges.length,undirected.size,'SAT must not repeat both directions of the same physical edge');

const CANNON=await import('../node_modules/cannon-es/dist/cannon-es.js');
const g=s.ingredients[0],reference=new CANNON.ConvexPolyhedron({vertices:g.vertices.map(p=>new CANNON.Vec3(...p)),faces:g.faces}),candidate=preparationCollisionHull(g),origin=new CANNON.Vec3(),qa=new CANNON.Quaternion(),qb=new CANNON.Quaternion();qb.setFromEuler(.31,.73,.19);
for(const xyz of [[0,0,0],[.001,.001,0],[.003,0,0],[.02,.01,.03],[-.002,.001,.002]]){const pos=new CANNON.Vec3(...xyz),a=new CANNON.Vec3(),b=new CANNON.Vec3(),hitA=reference.findSeparatingAxis(reference,origin,qa,pos,qb,a),hitB=candidate.findSeparatingAxis(candidate,origin,qa,pos,qb,b);assert.equal(hitB,hitA,'removing redundant edge orientation must preserve overlap');if(hitA)assert.ok(Math.abs(reference.testSepAxis(a,reference,origin,qa,pos,qb)-candidate.testSepAxis(b,candidate,origin,qa,pos,qb))<1e-10,'minimum penetration depth must agree');}
