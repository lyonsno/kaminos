import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('same-device live log never allocates the legacy canvas-copy bridge',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const source=html.match(/function createVolumeMainRendererBridge\(\) \{[\s\S]*?\n\}/)[0];
  const context={isLiveLogHeatRoute:()=>true,THREE:{CanvasTexture:function(){throw Error('Legacy canvas-copy bridge allocated on live-log route');}},volumePrototype:{canvasElement:()=>({})}};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.result=createVolumeMainRendererBridge();',context);
  assert.equal(context.result,null);
});
