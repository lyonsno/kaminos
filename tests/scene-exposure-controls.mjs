// kaminos-test: node
import assert from 'node:assert/strict';
import * as camera from '../scene-emissive-camera.mjs';
assert.equal(typeof camera.bindSceneExposureControls,'function','scene exposure must edit the canonical flame EV while matched');
class Control extends EventTarget {
  constructor(value){super();this.value=String(value);this.min='.2';this.max='4';this.step='.1';this.checked=false;this.ownerDocument={defaultView:{Event}};}
}
const exposure=new Control(1.1),flame=new Control(-2),match=new Control(0),label={textContent:'Exposure'},output={textContent:''};
flame.min='-8';flame.max='8';flame.step='any';
let independent=1.1,flameUpdates=0;
flame.addEventListener('input',()=>flameUpdates++);
const link=camera.bindSceneExposureControls({exposure,flame,match,label,output,readIndependent:()=>independent,writeIndependent:value=>independent=value,redraw(){}});
match.checked=true;match.dispatchEvent(new Event('change'));
assert.equal(exposure.value,'-2');assert.equal(exposure.min,'-8');assert.equal(label.textContent,'Exposure EV');
exposure.value='1.5';exposure.dispatchEvent(new Event('input'));
assert.equal(flame.value,'1.5');assert.equal(flameUpdates,1);assert.equal(independent,1.1);
flame.value='-3';flame.dispatchEvent(new Event('input'));assert.equal(exposure.value,'-3');
const saved=link.read();
match.checked=false;match.dispatchEvent(new Event('change'));
assert.equal(exposure.value,'1.1');assert.equal(exposure.min,'.2');assert.equal(flame.value,'-3');
exposure.value='2';exposure.dispatchEvent(new Event('input'));assert.equal(independent,2);assert.equal(flame.value,'-3');
flame.value='4';link.sync();assert.equal(exposure.value,'2','unmatched controls are independent');
link.write(saved);assert.equal(match.checked,true);assert.equal(flame.value,'-3');assert.equal(exposure.value,'-3');assert.equal(independent,1.1);
flame.value='-6';link.sync();assert.equal(exposure.value,'-6','silent preset/undo writes resync before presentation');
assert.throws(()=>link.write({...saved,flameEV:NaN}),/exposure/);
assert.equal(flame.value,'-6','invalid restoration is atomic');
link.write(link.check({...link.read(),value:2.5}));assert.equal(flame.value,'2.5','existing scene parameter value API edits flame EV when matched');
console.log('PASS exposure coupling, canonical flame events, independent restoration and history state');

// The adjacent inactive explanation follows scene -> GI inspection -> scene.
const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    if(sceneEmissiveCamera && (sceneGISettings.mode');
const end=html.indexOf('    syncWaterProxy();',start);assert(start>=0&&end>start);
const status={hidden:true,textContent:''},settings={mode:'combined',view:'scene'};
const scope={sceneEmissiveCamera:{update:()=>({effective:false,reason:'inactive-material'})},sceneGISettings:settings,
 document:{getElementById:id=>id==='rendering-match-flame-camera'?{checked:true}:status},window:{},
 renderPipeline:{},outlinedSceneOutput:{},outlinedCameraOutput:{},applySceneEmissiveCamera(){}};
runInNewContext('let sceneCameraStatusText="";function draw(){'+html.slice(start,end)+'}draw();sceneGISettings.view="ao";draw();sceneGISettings.view="scene";draw();',scope);
assert.match(status.textContent,/inactive-material/);assert.equal(status.hidden,false);
