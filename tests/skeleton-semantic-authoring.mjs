// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as edit from '../experiments/creature-motion/rest-skeleton-edit.mjs';
import {measureSkeleton} from '../experiments/creature-motion/skeleton-proportions.mjs';
import {captureRestTransform,applyRestTransform} from '../experiments/creature-motion/rest-skeleton-transform.mjs';
const refs=JSON.parse(fs.readFileSync(new URL('./fixtures/skeleton-reference-atlas.json',import.meta.url))).references;
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const feature=(p,r,id)=>measureSkeleton(p,r.profile).features.find(f=>f.id===id).value;
test('source Cat/Dog become exact editable named graphs with provenance and usable symmetry',()=>{
 assert.equal(typeof edit.referenceRestPlan,'function','Reference skeletons cannot yet seed editable bodies');
 for(const r of refs){const p=edit.referenceRestPlan(r);assert.equal(p.joints.length,r.jointNames.length);assert.deepEqual(p.joints.map(j=>j.name),r.jointNames);assert.deepEqual(p.joints.flatMap(j=>j.head),r.positions);assert.deepEqual(p.joints.map(j=>j.parent),r.parents.map(i=>i<0?null:r.jointNames[i]));assert.deepEqual(p.source_exemplar.source,r.source);assert.equal(edit.validateRestPlan(p).joints.length,r.jointNames.length);
 const l=r.profile.fore.left[0],other=r.profile.fore.right[0],start=captureRestTransform(p,{selected:[l],active:l,mirror:true,descendants:true,localToWorld:identity});const moved=applyRestTransform(p,{...start,position:start.position.map((v,i)=>v+(i===0?.02:0))});close(moved.joints.find(j=>j.name===other).head[0],p.joints.find(j=>j.name===other).head[0]-.02);
 const saved=edit.authoredRestPlan(p,{baselineSha256:r.source.sha256,displayMatrix:identity});assert.deepEqual(saved.rest_authoring.symmetry,p.rest_authoring.symmetry);
 }
});
test('girdle width/height/fore-aft move whole bilateral branches while preserving their lengths',()=>{
 assert.equal(typeof edit.shapeRestPlan,'function','Semantic proportion edits are missing');
 for(const r of refs){const p=edit.referenceRestPlan(r),before=structuredClone(p);for(const part of ['fore','hind']){const width=part==='fore'?'shoulderWidth':'hipWidth',reach=feature(p,r,part+'Reach');const q=edit.shapeRestPlan(p,r.profile,{part,property:'width',value:feature(p,r,width)*.75});close(feature(q,r,width),feature(p,r,width)*.75);close(feature(q,r,part+'Reach'),reach);
 for(const property of ['height','forward']){const values=edit.restShapeValues(p,r.profile,part);const moved=edit.shapeRestPlan(p,r.profile,{part,property,value:values[property]+.15});close(edit.restShapeValues(moved,r.profile,part)[property],values[property]+.15);close(feature(moved,r,part+'Reach'),reach);}
 }assert.deepEqual(p,before);}
});
test('reach scales branches; segment edits preserve other segment lengths; fixed reach redistribution is explicit',()=>{
 assert.equal(typeof edit.shapeRestPlan,'function');
 for(const r of refs){const p=edit.referenceRestPlan(r);for(const part of ['fore','hind']){const values=edit.restShapeValues(p,r.profile,part),long=edit.shapeRestPlan(p,r.profile,{part,property:'reach',value:values.reach*1.2});close(feature(long,r,part+'Reach'),values.reach*1.2);const segment=edit.shapeRestPlan(p,r.profile,{part,property:'segment',index:0,value:values.segments[0]*1.1});close(edit.restShapeValues(segment,r.profile,part).segments[1],values.segments[1]);const fraction=edit.shapeRestPlan(p,r.profile,{part,property:'proximalFraction',value:.4});close(feature(fraction,r,part+'ProximalFraction'),.4);close(feature(fraction,r,part+'Reach'),values.reach);}}
});
test('trunk span supports pelvis/front pins and explicit planted terminal points without changing topology',()=>{
 assert.equal(typeof edit.shapeRestPlan,'function');const r=refs[0],p=edit.referenceRestPlan(r),length=measureSkeleton(p,r.profile).trunk.length;
 for(const pin of ['pelvis','front','feet']){const q=edit.shapeRestPlan(p,r.profile,{part:'trunk',property:'length',value:1.25,pin});close(measureSkeleton(q,r.profile).trunk.length,length*1.25);assert.deepEqual(q.joints.map(j=>[j.name,j.parent]),p.joints.map(j=>[j.name,j.parent]));const names=pin==='feet'?['fore','hind'].flatMap(part=>['left','right'].flatMap(side=>r.profile[part][side].slice(-2))):[r.profile.trunk[pin==='front'?1:0]];for(const name of names)assert.deepEqual(q.joints.find(j=>j.name===name).head,p.joints.find(j=>j.name===name).head);if(pin!=='feet')close(feature(q,r,'foreReach')*1.25,feature(p,r,'foreReach'));}
});
test('bad ratios, degenerate body frame and absent landmarks refuse without mutating input',()=>{
 assert.equal(typeof edit.shapeRestPlan,'function');const r=refs[0],p=edit.referenceRestPlan(r),before=structuredClone(p);for(const value of [0,-1,NaN,Infinity])assert.throws(()=>edit.shapeRestPlan(p,r.profile,{part:'fore',property:'width',value}));assert.throws(()=>edit.shapeRestPlan(p,r.profile,{part:'fore',property:'proximalFraction',value:1}));assert.throws(()=>edit.shapeRestPlan(p,{...r.profile,trunk:['absent','other']},{part:'fore',property:'width',value:.2}));assert.deepEqual(p,before);
});
