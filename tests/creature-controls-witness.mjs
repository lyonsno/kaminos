// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateCreatureControlRead,validateCreatureDisplayRead} from '../tools/creature-controls-witness.mjs';
const sample={host:{id:'owned',route:'shared-owner-scene',scene:{rendererBackend:'webgpu'}},source:{frameSha256:'f',caseSha256:'s'},currentSkin:{current:{case_sha256:'s'},pending:null},skin:{bones:28,vertices:3},playback:{frame:0,frames:3},transform:{position:[0,0,0]}},setup={frame_sha256:'f'};
sample.registration=[{id:'owned',objectVisible:true}];sample.vertices=[1,0,0,0,1,0,0,0,1];
validateCreatureControlRead(sample,setup);
for(const change of [s=>s.host.route='fallback',s=>s.host.scene.rendererBackend='webgl',s=>s.source.frameSha256='stale',s=>s.source.caseSha256='wrong',s=>s.currentSkin.pending={},s=>s.skin.vertices=0,s=>s.skin.bones=7,s=>s.playback.frame=3,s=>s.transform.position=[NaN,0,0],s=>s.host.id=null]){const s=structuredClone(sample);change(s);assert.throws(()=>validateCreatureControlRead(s,setup));}
for(const change of [s=>s.registration=[],s=>s.registration[0].objectVisible=false,s=>s.vertices=[],s=>s.vertices.fill(0),s=>s.vertices[0]=NaN]){const s=structuredClone(sample);change(s);assert.throws(()=>validateCreatureControlRead(s,setup));}
console.log('Native control witness rejects wrong/fallback source and route, partial body, invalid clock and absent registration');
const display={display:{castsShadows:true,receivesShadows:true,boneMarkers:Array.from({length:28},()=>({visible:false}))},mode:'path',source:{presentation:{mode:'path'}},pathGuide:{mode:'path',visible:true,points:129,kind:'complete-circular-rail'}};
const expected={bones:false,paths:true,mode:'path'};validateCreatureDisplayRead(display,expected);
assert.throws(()=>validateCreatureDisplayRead({...display,cycle:0},{...expected,minimumCycle:1}),/cycle/i,'Path witness accepts no repeat as a completed cycle');
const staleSwitch=structuredClone(display);staleSwitch.motion={id:'walk-1'};
assert.throws(()=>validateCreatureDisplayRead(staleSwitch,{...expected,motionId:'trot-2'}),/motion/i,'Path witness accepts the previous motion instead of the requested switch');
for(const change of [s=>s.display.castsShadows=false,s=>s.display.boneMarkers=[],s=>s.display.boneMarkers[0].visible=true,s=>s.mode='cycle',s=>s.source.presentation.mode='cycle',s=>s.pathGuide.mode='cycle',s=>s.pathGuide.visible=false,s=>s.pathGuide.points=0]){const r=structuredClone(display);change(r);assert.throws(()=>validateCreatureDisplayRead(r,expected));}
const witness=readFileSync(new URL('../tools/creature-controls-witness.mjs',import.meta.url),'utf8'),marker=witness.indexOf("await page.getByLabel('Open creature setup'"),start=witness.indexOf('await page.waitForFunction(',marker)+'await page.waitForFunction('.length,end=witness.indexOf(',{sha:target.case_sha256,previousId})',start);
assert.ok(marker>=0&&end>start);const reopenGate=witness.slice(start,end),check=window=>vm.runInNewContext('('+reopenGate+')({sha:"new",previousId:"old"})',{window});
assert.equal(check({}),false,'Setup reopen must wait through the disposed-owner/new-owner lifetime gap');
assert.equal(check({kaminosWalkingCreature:()=>({host:{id:'old'},source:{caseSha256:'new'},rate:.5})}),false);
assert.equal(check({kaminosWalkingCreature:()=>({host:{id:'new'},source:{caseSha256:'new'},rate:.5})}),true);
