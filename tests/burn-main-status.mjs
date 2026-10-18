// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('collision inspector names an unread GPU field without formatting a fabricated count',()=>{
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function syncKilnCollisionControl('),source.indexOf('\nfunction installKilnCollisionControl('));
 const input={},status={},resolution={};
 const context={document:{getElementById:id=>id==='kiln-collision-enabled'?input:id==='kiln-collision-status'?status:resolution},volumePrototype:{debugState:()=>({simGridDimensions:[32,32,32]})},isAuthoredKilnCollisionRoute:()=>true,sceneObjects:[{collision:{enabled:true}}],syncCollisionVoxelView(){}};
 vm.runInNewContext(fn+';syncKilnCollisionControl({requested:true,effective:"mesh-voxel-solid",backend:"gpu",solidCellCount:null})',context);
 assert.match(status.textContent,/unverified/i);
});
