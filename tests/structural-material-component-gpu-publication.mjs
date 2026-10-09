import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const text=fs.readFileSync(new URL('../structural-material-component-gpu-transport.js',import.meta.url),'utf8'),source=text.slice(text.indexOf('const surfaceStates='),text.indexOf('export function createGpuTransport(')),copies=[],buffers=[];
const device={createBuffer(request){const b={...request,destroyed:false,destroy(){this.destroyed=true;}};buffers.push(b);return b;},createCommandEncoder(){return{copyBufferToBuffer(...args){copies.push(args);},finish(){return{};}};},queue:{submit(){}}},state={size:64},resident={device,stateBuffer:()=>state};
const acquire=vm.runInNewContext(source+';acquireSurfaceState',{WeakMap,GPUBufferUsage:{STORAGE:1,COPY_DST:2}}),a=acquire(resident),b=acquire(resident);
assert.equal(a.buffer,b.buffer,'Pieces share one published pose, not separate copied generations');assert.notEqual(a.buffer,state,'In-flight solver writes must not change the displayed pose');assert.equal(copies.length,0);a.capture();assert.equal(copies.length,1);assert.equal(copies[0][0],state);assert.equal(copies[0][2],a.buffer);assert.equal(copies[0][4],64);
a.release();assert.equal(a.buffer.destroyed,false);b.release();assert.equal(a.buffer.destroyed,true);const c=acquire(resident);assert.notEqual(c.buffer,a.buffer);c.release();assert.equal(state.destroyed,undefined,'Surface disposal must never destroy material state');
console.log('Published GPU pose has shared piece ownership, explicit capture, and independent material lifetime.');
