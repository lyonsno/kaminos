import assert from 'node:assert/strict';
const imported=await import('../structural-material-solid-resident.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
assert.ok(imported?.createSolidResident,'The material state must persist across GPU steps');
const device={limits:{maxStorageBufferBindingSize:1e9},createBuffer(){throw new Error('GPU allocation reached');}};
for(const descriptor of [{},{kind:'fallback',points:4,elements:1,bonds:6,colorCount:4},{kind:'graph',points:4,elements:1,bonds:6,colorCount:0}])await assert.rejects(imported.createSolidResident(device,descriptor,{}),error=>!error.message.includes('GPU allocation reached'));
console.log('Resident material admission rejects incomplete or substituted routes');
