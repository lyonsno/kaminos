// kaminos-test: node
import assert from 'node:assert/strict';
import {createPlaceAuthoring,initialPlace,samplePlace,planPlace} from '../stockroom-place-state.mjs';
import {createPlaceView} from '../stockroom-place-view.mjs';
import {installPlaceControls} from '../stockroom-place-controls.mjs';
assert.equal(typeof installPlaceControls,'function','The experiment controller must load with the state and view');

const a=createPlaceAuthoring();
assert.equal(a.read().mode,'establish','The place has an explicit author-owned activity');
const start=a.read();a.realize('deck');
assert.equal(a.read().mode,'establish','Resolution must not switch the author to Work');
assert.deepEqual(a.read().regions,start.regions);
assert.ok(planPlace(a.read()).boards.length>0);

a.add('space',{center:[1,0],half:[.55,.52],shape:'ellipse'});
const empty=a.read().regions.at(-1),hole=[...empty.center];
assert.ok(samplePlace(a.read(),...hole)>0,'Active space excludes host construction');
const carved=planPlace(a.read());
assert.ok(!carved.boards.some(b=>Math.abs(b.position[0]-hole[0])<b.size[0]/2&&Math.abs(b.position[2]-hole[1])<b.size[2]/2));
for(const member of [...carved.boards,...carved.frame,...carved.edges])for(const x of [-.5,0,.5])for(const z of [-.5,0,.5]){
 assert.ok(samplePlace(a.read(),member.position[0]+x*member.size[0],member.position[2]+z*member.size[2])<=1e-8,`${member.id} must fit its whole footprint in the occupied allocation`);
}
a.add('material',{center:hole,half:[.3,.3],shape:'ellipse'});
assert.ok(samplePlace(a.read(),...hole)>0,'A continuing empty claim is not overwritten by added material');
a.remove(empty.id);
assert.ok(samplePlace(a.read(),...hole)<0,'Withdrawing the empty instruction releases its condition');

const region=a.read().regions.find(r=>r.role==='material'),old=structuredClone(region);
a.begin({kind:'boundary',id:region.id,axis:0,sign:1});a.preview(1);a.commit();
const resized=a.read().regions.find(r=>r.id===region.id);
assert.equal(resized.center[0]-resized.half[0],old.center[0]-old.half[0]);
assert.equal(resized.center[0]+resized.half[0],old.center[0]+old.half[0]+1);
a.back();assert.deepEqual(a.read().regions.find(r=>r.id===region.id),old);

a.mode('work');a.begin({kind:'fit'});a.preview([0,0]);
const preview=a.read();assert.equal(preview.stage,'fitting');assert.equal(preview.insert.fitted,true);
a.commit();
assert.ok(samplePlace(a.read(),0,0)>0,'The receiver excludes the host');
assert.equal(planPlace(a.read()).insert.present,true,'The intended insert occupies its receiver');
const fit=structuredClone(a.read().insert);
a.mode('establish');a.realize('proxy');a.realize('deck');
a.begin({kind:'boundary',id:region.id,axis:0,sign:-1});a.preview(.8);a.commit();
assert.deepEqual(a.read().insert,fit,'Macro edits do not discard the local fitted relationship');
assert.equal(a.read().mode,'establish');

const before=a.read();assert.throws(()=>a.add('material',{center:[NaN,0],half:[1,1]}));assert.deepEqual(a.read(),before);
a.begin({kind:'boundary',id:region.id,axis:0,sign:1});const valid=a.read();assert.throws(()=>a.preview(-100));assert.deepEqual(a.read(),valid);a.cancel();assert.deepEqual(a.read(),before);
const roundtrip=createPlaceAuthoring(JSON.parse(JSON.stringify(a.model())));assert.deepEqual(roundtrip.model(),a.model());
assert.equal(initialPlace().schema,'kaminos.stockroom-place.v1');
const fresh=createPlaceAuthoring(),seed=fresh.model();fresh.begin({kind:'create',role:'space',center:[1,0],axis:0,sign:1,radius:.4});fresh.preview(.8);assert.equal(fresh.read().regions.at(-1).role,'space');fresh.cancel();assert.deepEqual(fresh.model(),seed,'A cancelled creation leaves no seed region behind');
const view=createPlaceView();view.update(seed);
assert.equal(view.targets().length,6,'Whole-region handles coexist with selected boundary handles');
const meshes=()=>{const items=[];view.root.traverse(m=>{if(m.isInstancedMesh)items.push(m);});return items;};
const originalMeshes=meshes();view.update({...seed,height:1.5});assert.deepEqual(meshes(),originalMeshes,'Small previews reuse member instances');
view.root.traverse(m=>{if(m.isMesh)for(const v of m.geometry.attributes.position.array)assert.ok(Number.isFinite(v),'Proxy and realized geometry remain finite');});
fresh.realize('deck');fresh.mode('work');fresh.begin({kind:'fit'});fresh.preview([0,0]);fresh.commit();fresh.begin({kind:'fold'});fresh.preview(Math.PI/3);fresh.commit();
view.update(fresh.model());const folded=view.foldPoint(Math.PI/3);assert.ok(folded[1]>fresh.read().height+.9,'Articulation lifts the actual prepared insert around its hinge');
assert.equal(view.targets().length,2,'Work exposes the insert, not the region controls');
const closed=fresh.model();fresh.mode('establish');fresh.begin({kind:'move',id:'extension'});fresh.preview([.4,.2]);fresh.commit();
assert.deepEqual(fresh.read().insert,closed.insert,'The host-scoped receiver remains in place while an allocation moves');
view.update(fresh.model());fresh.back();assert.deepEqual(fresh.model().regions,closed.regions);
fresh.mode('work');fresh.begin({kind:'fit'});const beforeInvalid=fresh.model();assert.throws(()=>fresh.preview([20,20]),/host material/);assert.deepEqual(fresh.model(),beforeInvalid);fresh.cancel();
view.dispose();
console.log('Place resolution, active-space, fitting, return and state invariants pass');
