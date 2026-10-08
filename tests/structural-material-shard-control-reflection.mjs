import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const text=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),source=text.slice(text.indexOf('window.__stoneShards={'),text.indexOf('window.__stoneShards.settle'));
const threshold={min:'2',max:'100',step:'1',_value:'18',get value(){return this._value;},set value(v){this._value=String(Math.max(Number(this.min),Math.min(Number(this.max),Number(v))));}},pause={attrs:{},setAttribute(k,v){this.attrs[k]=v;}},value={value:'18'};
const ctx={window:{},route:'fixture',reset(){},release(){},advance(){},beginPick(){},paused:false,Play:'play',Pause:'pause',icon(){},stamp(){},$:(id)=>({threshold,pause,thresholdValue:value})[id]};vm.runInNewContext(source,ctx);
const api=ctx.window.__stoneShards;api.pause(true);assert.equal(pause.attrs['aria-pressed'],'true','API hold must be reflected by the operator control');api.pause(false);assert.equal(pause.attrs['aria-pressed'],'false');
for(const requested of [1000,.125,18]){api.threshold(requested);assert.equal(Number(threshold.value),requested,'A caller threshold must not be silently clipped by the slider');assert.equal(Number(value.value),requested);}
console.log('Shared API pause and threshold state are reflected without silent caller clipping');
