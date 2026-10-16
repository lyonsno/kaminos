// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {COMPOSITION_SCHEMA,compositionRestoreUrl,forwardCompositionHash} from '../scene-authoring.mjs';
import {joinedRouteParams,writeJoinedRoute} from '../volume-joined-route.mjs';
test('saved scene retains its joined exterior through the basin launcher',()=>{
 const route={volume_light_field:'1',volume_light_field_scene_depth:'1',volume_joined:'1',volume_joined_size:'2',volume_joined_resolution:'24',volume_joined_budget:'32',volume_joined_wall:'none',volume_joined_bounds:'1'};
 const composition={schema:COMPOSITION_SCHEMA,flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},lightGainStops:0,route};
 const saved=new URL(compositionRestoreUrl(composition,'joined.kaminos.json','http://localhost'));
 const live=new URL(forwardCompositionHash('http://localhost/?settings_preset=exact',saved.hash));
 const restored=new URLSearchParams(live.hash.slice(1));
 for(const [key,value] of Object.entries(route))assert.equal(restored.get(key),value,key);
 assert.equal(joinedRouteParams(live).get('volume_joined_resolution'),'24');
 assert.throws(()=>compositionRestoreUrl({...composition,route:{...route,volume_joined_unknown:'1'}},'joined.kaminos.json','http://localhost'),/Unsupported composition route/);
});
test('a live joined edit supersedes the restored hash without losing scene identity',()=>{
 const before='http://localhost/?volume_joined_size=1.5#scene=joined.kaminos.json&volume_joined_size=2&volume_joined=1';
 assert.equal(joinedRouteParams(new URL(before)).get('volume_joined_size'),'2');
 const after=new URL(writeJoinedRoute(before,{volume_joined:'1',volume_joined_size:'3'}));
 assert.equal(joinedRouteParams(after).get('volume_joined_size'),'3');
 assert.equal(new URLSearchParams(after.hash.slice(1)).get('scene'),'joined.kaminos.json');
});
