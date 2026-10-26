// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {atmosphereSettings,transmittance,compositeFoggedVolume,flakePosition} from '../ash/atmosphere-plan.mjs';
test('shared haze composes a premultiplied flame over a fogged receiver without double fog',()=>{
 const density=.03,front=7,back=23,alpha=.65,fire=[.4,.2,.05],surface=[.1,.4,.7],fog=[.15,.13,.11];
 const T=transmittance(density,front),B=transmittance(density,back-front);
 const scene=surface.map((c,i)=>c*T*B+fog[i]*(1-T*B));
 const overlay=compositeFoggedVolume({color:fire,alpha,fog,density,distance:front});
 for(let i=0;i<3;i++)assert.ok(Math.abs(overlay[i]+(1-alpha)*scene[i]-(T*fire[i]+(1-T)*fog[i]+(1-alpha)*T*(B*surface[i]+(1-B)*fog[i])))<1e-12);
 assert.deepEqual(compositeFoggedVolume({color:fire,alpha,fog,density:0,distance:front}),fire);
 assert.deepEqual(compositeFoggedVolume({color:[0,0,0],alpha:0,fog,density,distance:front}),[0,0,0]);
});
test('camera-following flakes retain world motion and count across ordinary camera travel',()=>{
 const size=[24,12,24],wind=[.035,-.08,.018],time=19;
 const a=flakePosition({index:37,time,camera:[0,2,0],extent:size,wind});
 const b=flakePosition({index:37,time,camera:[.01,2,.01],extent:size,wind});
 for(let k=0;k<3;k++)assert.ok(Math.abs(a[k]-b[k])<1e-10);
 const c=flakePosition({index:37,time:time+.001,camera:[0,2,0],extent:size,wind});
 for(let k=0;k<3;k++)assert.ok(Math.abs(c[k]-a[k]-wind[k]*.001)<1e-10);
 for(let index=0;index<100;index++)assert.ok(flakePosition({index,time,camera:[100,3,-100],extent:size,wind}).every((v,k)=>Math.abs(v-[100,3,-100][k])<=size[k]/2));
});
test('settings retain fidelity requests and invalid updates cannot silently select defaults',()=>{
 const s=atmosphereSettings({count:43127,flakeSize:.004,density:.014});assert.equal(s.count,43127);assert.equal(s.flakeSize,.004);assert.equal(s.density,.014);
 for(const patch of [{count:-1},{count:3.2},{flakeSize:0},{density:NaN},{wind:[0,Infinity,0]},{extent:[24,0,24]},{enabled:'yes'},{color:[1,-1,1]}])assert.throws(()=>atmosphereSettings(patch),/ash atmosphere/);
 assert.equal(transmittance(0,100),1);assert.equal(transmittance(.1,0),1);
});

test('atmosphere settings resize without a hidden count cap and restore borrowed channels on close',async()=>{
 const THREE=await import('../lib/three.webgpu.js'),{createAshAtmosphere}=await import('../ash/atmosphere-gpu.mjs');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();scene.background=new THREE.Color(.02,.02,.02);
 const previousFog=scene.fogNode,previousBackground=scene.backgroundNode;
 const original={density:0,color:[0,0,0],displayColor:[0,0,0]};let shared=structuredClone(original);
 const volume={sharedAshAtmosphere:()=>structuredClone(shared),setSharedAshAtmosphere:s=>{shared=structuredClone(s);}};
 const a=createAshAtmosphere({scene,camera,renderer:{toneMappingExposure:1.5},volume});
 a.set({count:43127});assert.equal(a.read().allocatedInstances,43127);assert.equal(a.root.children[0].count,43127);
 const before=a.read();assert.throws(()=>a.set({density:-1}),/ash atmosphere/);assert.deepEqual(a.read(),before);
 a.set({enabled:false});assert.equal(a.root.visible,false);assert.equal(shared.density,0);assert.equal(scene.fogNode,previousFog);
 a.set({enabled:true});a.tick(7);assert.equal(a.read().time,7);assert.equal(shared.density,.018);
 a.dispose();assert.equal(scene.fogNode,previousFog);assert.equal(scene.backgroundNode,previousBackground);assert.deepEqual(shared,original);a.dispose();
});
